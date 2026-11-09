package com.dave.slack

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Background update check. WorkManager runs this every few hours when there's a network;
 * if a newer build exists it downloads the APK and posts the "update ready" notification.
 * That notification is the "push to your phone" — tap it to install.
 */
class UpdateWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val release = Updater.latestRelease(applicationContext) ?: return Result.success()
        if (!Updater.isNewer(release)) return Result.success()
        val apk = Updater.download(applicationContext, release) ?: return Result.retry()
        Updater.notifyUpdate(applicationContext, release, apk)
        return Result.success()
    }
}
