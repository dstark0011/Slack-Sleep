package com.dave.slack

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ElevationGainedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.reflect.KClass

/**
 * Reads Garmin data that Garmin Connect writes to Health Connect (and Hevy
 * workouts, if Hevy's Health Connect sync is on) and builds the same
 * one-row-per-night table as sync/build_features.py on the PC.
 *
 * Not available through Health Connect: Garmin's sleep score, daytime stress
 * and Body Battery. Those fields are left empty and the app hides them.
 */
class HealthData(private val context: Context) {

    companion object {
        const val DAYS = 120L
        const val ZONE4_FLOOR_BPM = 152
        const val NEED_MINUTES = 470

        val PERMISSIONS = setOf(
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(RestingHeartRateRecord::class),
            HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(FloorsClimbedRecord::class),
            HealthPermission.getReadPermission(ElevationGainedRecord::class),
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            // Lets the app read more than the 30 days before permission was granted.
            "android.permission.health.READ_HEALTH_DATA_HISTORY",
        )

        private val RUN_TYPES = setOf(
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL,
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY,
        )
        private val WALK_TYPES = setOf(
            ExerciseSessionRecord.EXERCISE_TYPE_WALKING,
            ExerciseSessionRecord.EXERCISE_TYPE_HIKING,
        )
        private val LIFT_TYPES = setOf(
            ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
            ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING,
        )
    }

    val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }
    private val zone: ZoneId = ZoneId.systemDefault()

    fun available(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    suspend fun hasCorePermissions(): Boolean =
        client.permissionController.getGrantedPermissions()
            .contains(HealthPermission.getReadPermission(SleepSessionRecord::class))

    private suspend fun <T : Record> readAll(type: KClass<T>, from: Instant, to: Instant): List<T> {
        val out = mutableListOf<T>()
        var token: String? = null
        do {
            val resp = try {
                client.readRecords(
                    ReadRecordsRequest(
                        recordType = type,
                        timeRangeFilter = TimeRangeFilter.between(from, to),
                        pageToken = token,
                    )
                )
            } catch (e: SecurityException) {
                return out // permission for this type not granted; carry on without it
            }
            out += resp.records
            token = resp.pageToken
        } while (token != null)
        return out
    }

    private fun localDate(t: Instant): LocalDate = t.atZone(zone).toLocalDate()

    /** Builds `window.SLACK_DATA = {...}` for the web UI. */
    suspend fun buildDataJs(): Pair<String, Int> {
        val to = Instant.now()
        val from = to.minus(Duration.ofDays(DAYS))

        val sleeps = nights(readAll(SleepSessionRecord::class, from, to))
        val hr = readAll(HeartRateRecord::class, from, to)
            .flatMap { r -> r.samples.map { it.time to it.beatsPerMinute.toInt() } }
            .sortedBy { it.first }
        val rhr = readAll(RestingHeartRateRecord::class, from, to)
            .associate { localDate(it.time) to it.beatsPerMinute.toInt() }
        val hrv = readAll(HeartRateVariabilityRmssdRecord::class, from, to)
        val steps = readAll(StepsRecord::class, from, to)
            .groupBy { localDate(it.startTime) }.mapValues { e -> e.value.sumOf { it.count } }
        val floors = readAll(FloorsClimbedRecord::class, from, to)
            .groupBy { localDate(it.startTime) }.mapValues { e -> e.value.sumOf { it.floors } }
        val elev = readAll(ElevationGainedRecord::class, from, to)
            .groupBy { localDate(it.startTime) }.mapValues { e -> e.value.sumOf { it.elevation.inMeters } }
        val exercise = readAll(ExerciseSessionRecord::class, from, to)

        // Day-before features
        data class Day(var z45: Double = 0.0, var hour: Int? = null, var walk: Double = 0.0, var lift: Int = 0)
        val days = mutableMapOf<LocalDate, Day>()
        for (ex in exercise) {
            val d = days.getOrPut(localDate(ex.startTime)) { Day() }
            val mins = Duration.between(ex.startTime, ex.endTime).toMinutes().toDouble()
            when (ex.exerciseType) {
                in RUN_TYPES -> {
                    d.z45 += zoneMinutes(hr, ex.startTime, ex.endTime)
                    d.hour = ex.startTime.atZone(zone).hour
                }
                in WALK_TYPES -> d.walk += mins
                in LIFT_TYPES -> d.lift = 1
            }
        }

        val rows = JSONArray()
        for (s in sleeps) {
            val wake = localDate(s.endTime)
            val prev = wake.minusDays(1)
            var deep = 0L; var light = 0L; var rem = 0L; var awake = 0L; var awakeN = 0
            for (st in s.stages) {
                val sec = Duration.between(st.startTime, st.endTime).seconds
                when (st.stage) {
                    SleepSessionRecord.STAGE_TYPE_DEEP -> deep += sec
                    SleepSessionRecord.STAGE_TYPE_REM -> rem += sec
                    SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                    SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> { awake += sec; awakeN++ }
                    else -> light += sec
                }
            }
            val total = Duration.between(s.startTime, s.endTime).seconds
            if (s.stages.isEmpty()) light = total
            val asleep = if (s.stages.isEmpty()) total else deep + light + rem
            val inSleep = hr.filter { it.first >= s.startTime && it.first <= s.endTime }.map { it.second }
            val nightHrv = hrv.filter { it.time >= s.startTime && it.time <= s.endTime.plus(Duration.ofHours(2)) }
                .map { it.heartRateVariabilityMillis }
            val day = days[prev]
            val climb = (elev[prev] ?: 0.0).let { if (it > 0) it else (floors[prev] ?: 0.0) * 3.0 }

            rows.put(JSONArray().apply {
                put(wake.toString()); put(s.startTime.epochSecond); put(s.endTime.epochSecond)
                put(0) // Garmin sleep score: not shared to Health Connect
                put(asleep); put(deep); put(light); put(rem); put(awake); put(awakeN)
                put(0) // overnight stress: not shared
                put(rhr[wake] ?: inSleep.minOrNull() ?: 0)
                put(if (nightHrv.isNotEmpty()) nightHrv.average().roundToInt() else JSONObject.NULL)
                put(JSONObject.NULL); put(JSONObject.NULL) // daytime stress, high-stress %: not shared
                put(((day?.z45 ?: 0.0) * 10).roundToInt() / 10.0); put(0)
                put(day?.hour ?: JSONObject.NULL)
                put((day?.walk ?: 0.0).roundToInt()); put(climb.roundToInt()); put(day?.lift ?: 0); put(0)
                put(steps[prev] ?: JSONObject.NULL)
                put("home"); put(0) // location and travel: tag them in the Journal
            })
        }

        val detail = JSONObject()
        for (s in sleeps) { // full stage + heart-rate detail for every night
            val level = { stage: Int ->
                when (stage) {
                    SleepSessionRecord.STAGE_TYPE_DEEP -> 0
                    SleepSessionRecord.STAGE_TYPE_REM -> 2
                    SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                    SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> 3
                    else -> 1
                }
            }
            val levels = JSONArray()
            s.stages.sortedBy { it.startTime }.forEach {
                levels.put(JSONArray().put(it.startTime.epochSecond).put(it.endTime.epochSecond).put(level(it.stage)))
            }
            val hrs = JSONArray()
            var lastT = 0L
            hr.filter { it.first >= s.startTime && it.first <= s.endTime }.forEach {
                if (it.first.epochSecond - lastT >= 90) {
                    hrs.put(JSONArray().put(it.first.epochSecond).put(it.second)); lastT = it.first.epochSecond
                }
            }
            if (levels.length() > 0 && hrs.length() > 1) {
                detail.put(localDate(s.endTime).toString(), JSONObject().apply {
                    put("start", s.startTime.epochSecond); put("end", s.endTime.epochSecond)
                    put("levels", levels); put("hr", hrs); put("bb", JSONObject.NULL)
                })
            }
        }

        val data = JSONObject().put("need", NEED_MINUTES).put("source", "healthconnect")
            .put("nights", rows).put("detail", detail)
        return "window.SLACK_DATA = $data;\n" to rows.length()
    }


    /** One sleep period per night, built from whatever sessions Health Connect holds. */
    class Night(var startTime: Instant, var endTime: Instant, var stages: List<SleepSessionRecord.Stage>)

    /**
     * Health Connect can hold the same night several times (Garmin plus other
     * apps such as Sleep Cycle), and Garmin sometimes splits one night into
     * pieces. Use Garmin's sessions when there are any, join pieces less than
     * 90 minutes apart, drop overlapping stages, then keep one night per wake-up
     * date: the longest.
     */
    private fun nights(all: List<SleepSessionRecord>): List<Night> {
        val garmin = all.filter { it.metadata.dataOrigin.packageName.contains("garmin", ignoreCase = true) }
        val src = (if (garmin.isNotEmpty()) garmin else all).sortedBy { it.startTime }
        val merged = mutableListOf<Night>()
        for (s in src) {
            val last = merged.lastOrNull()
            if (last != null && !s.startTime.isAfter(last.endTime.plus(Duration.ofMinutes(90)))) {
                if (s.endTime.isAfter(last.endTime)) last.endTime = s.endTime
                last.stages = last.stages + s.stages
            } else {
                merged += Night(s.startTime, s.endTime, s.stages)
            }
        }
        merged.forEach { n ->
            val clean = mutableListOf<SleepSessionRecord.Stage>()
            var lastEnd = Instant.EPOCH
            for (st in n.stages.sortedBy { it.startTime }) {
                if (!st.startTime.isBefore(lastEnd)) { clean += st; lastEnd = st.endTime }
            }
            n.stages = clean
        }
        return merged
            .filter { Duration.between(it.startTime, it.endTime).toHours() >= 3 }
            .groupBy { localDate(it.endTime) }
            .map { (_, v) -> v.maxByOrNull { Duration.between(it.startTime, it.endTime) }!! }
            .sortedBy { it.startTime }
    }

    /** Minutes at or above zone 4 during an exercise session, from HR samples. */
    private fun zoneMinutes(hr: List<Pair<Instant, Int>>, start: Instant, end: Instant): Double {
        val s = hr.filter { it.first >= start && it.first <= end }
        var secs = 0L
        for (i in 1 until s.size) {
            if (s[i - 1].second >= ZONE4_FLOOR_BPM) {
                secs += min(Duration.between(s[i - 1].first, s[i].first).seconds, 120L)
            }
        }
        return secs / 60.0
    }
}
