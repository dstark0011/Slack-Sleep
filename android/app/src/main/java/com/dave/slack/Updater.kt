package com.dave.slack

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Self-updater. Slack is sideloaded (not on the Play Store), so it keeps itself current by
 * checking this repo's GitHub releases, downloading the newest APK and handing it to the
 * system installer. CI stamps each build's versionCode with the Actions run number, so
 * "is there a newer one?" is just a number comparison. No login: releases are public.
 *
 * Android will not let a sideloaded app install silently — the user taps once to confirm —
 * so the flow is: check -> download -> notification -> one tap -> system install prompt.
 */
object Updater {
    private const val TAG = "Updater"
    private const val CHANNEL_ID = "updates"
    private const val NOTIF_ID = 4201
    private const val PREFS = "updater"
    private const val KEY_LAST_CHECK = "last_check"
    private const val FOREGROUND_THROTTLE_MS = 3 * 60 * 60 * 1000L // don't re-check on every launch

    data class Release(val versionCode: Int, val apkUrl: String, val name: String)

    fun shouldForegroundCheck(ctx: Context): Boolean {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return System.currentTimeMillis() - p.getLong(KEY_LAST_CHECK, 0L) > FOREGROUND_THROTTLE_MS
    }

    private fun markChecked(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply()
    }

    fun isNewer(r: Release) = r.versionCode > BuildConfig.VERSION_CODE

    /** Ask GitHub for the latest release. Returns null on any failure (offline, rate-limited, no asset). */
    fun latestRelease(ctx: Context): Release? {
        markChecked(ctx)
        val api = "https://api.github.com/repos/${BuildConfig.RELEASE_REPO}/releases/latest"
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(api).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 15000
                setRequestProperty("User-Agent", "Slack-Sleep-Updater")
                setRequestProperty("Accept", "application/vnd.github+json")
            }
            if (conn.responseCode != 200) {
                Log.w(TAG, "releases/latest -> ${conn.responseCode}")
                return null
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val obj = JSONObject(body)
            val tag = obj.optString("tag_name") // e.g. "build-42"
            val code = Regex("\\d+").findAll(tag).lastOrNull()?.value?.toIntOrNull() ?: return null
            val assets = obj.optJSONArray("assets") ?: return null
            var apkUrl: String? = null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                val name = a.optString("name")
                if (name.endsWith(".apk")) {
                    apkUrl = a.optString("browser_download_url")
                    if (name == "slack.apk") break // prefer the canonical name
                }
            }
            apkUrl?.let { Release(code, it, obj.optString("name", tag)) }
        } catch (e: Exception) {
            Log.w(TAG, "update check failed", e)
            null
        } finally {
            conn?.disconnect()
        }
    }

    /** Download the release APK into cache. Returns the file, or null on failure. */
    fun download(ctx: Context, r: Release): File? {
        val out = File(ctx.cacheDir, "slack-update-${r.versionCode}.apk")
        if (out.exists() && out.length() > 0) return out
        val tmp = File(ctx.cacheDir, "slack-update.part")
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(r.apkUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 60000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Slack-Sleep-Updater")
            }
            if (conn.responseCode != 200) {
                Log.w(TAG, "apk download -> ${conn.responseCode}")
                return null
            }
            conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
            if (tmp.length() <= 0L) return null
            // drop any older cached APKs
            ctx.cacheDir.listFiles { f -> f.name.startsWith("slack-update-") && f.name != out.name }
                ?.forEach { it.delete() }
            if (out.exists()) out.delete()
            tmp.renameTo(out)
            out
        } catch (e: Exception) {
            Log.w(TAG, "download failed", e)
            tmp.delete()
            null
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * Stream the APK into a PackageInstaller session and commit. Because every build is signed
     * with the committed debug key, this is an in-place update that keeps journal tags/localStorage.
     * The system shows the install confirmation; [InstallReceiver] surfaces it.
     */
    fun install(ctx: Context, apk: File) {
        try {
            val installer = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                apk.inputStream().use { input ->
                    session.openWrite("slack.apk", 0, apk.length()).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                val statusIntent = Intent(ctx, InstallReceiver::class.java).setAction(InstallReceiver.ACTION)
                val flags = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                    PendingIntent.FLAG_MUTABLE else 0) or PendingIntent.FLAG_UPDATE_CURRENT
                val pending = PendingIntent.getBroadcast(ctx, sessionId, statusIntent, flags)
                session.commit(pending.intentSender)
            }
        } catch (e: Exception) {
            Log.w(TAG, "install failed", e)
        }
    }

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = ctx.getSystemService(NotificationManager::class.java)
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_DEFAULT)
                        .apply { description = "Tells you when a new Slack build is ready to install" }
                )
            }
        }
    }

    /** Post the "update ready" notification; tapping it opens the app and installs the downloaded APK. */
    fun notifyUpdate(ctx: Context, r: Release, apk: File) {
        ensureChannel(ctx)
        val tap = Intent(ctx, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(MainActivity.EXTRA_INSTALL_APK, apk.absolutePath)
        }
        val flags = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            PendingIntent.FLAG_IMMUTABLE else 0) or PendingIntent.FLAG_UPDATE_CURRENT
        val pending = PendingIntent.getActivity(ctx, 1, tap, flags)
        val notif = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Slack update ready")
            .setContentText("Tap to install build ${r.versionCode}")
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIF_ID, notif)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted — harmless; the next foreground open installs directly.
            Log.w(TAG, "notify blocked", e)
        }
    }
}
