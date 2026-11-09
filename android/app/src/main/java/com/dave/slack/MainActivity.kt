package com.dave.slack

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Hosts the Slack web UI (bundled in assets/web) in a full-screen WebView.
 * The data file the UI expects (data/slack-data.js) is generated on the phone
 * from Health Connect and served to the WebView from the app's own storage.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        /** When present on the launch Intent, the app installs the downloaded APK at this path. */
        const val EXTRA_INSTALL_APK = "install_apk"
        private const val UPDATE_WORK = "slack-update-check"
    }

    private lateinit var web: WebView
    private val health by lazy { HealthData(this) }
    private val dataFile by lazy { File(filesDir, "slack-data.js") }

    private val requestPermissions =
        registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
            refresh()
        }

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* best-effort */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/data/") { path ->
                if (path == "slack-data.js" && dataFile.exists())
                    WebResourceResponse("text/javascript", "utf-8", dataFile.inputStream())
                else null
            }
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true // journal tags live in localStorage
        web.setBackgroundColor(0xFF000000.toInt())
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                startActivity(Intent(Intent.ACTION_VIEW, url)) // external links open in the browser
                return true
            }
        }

        if (dataFile.exists()) showApp() else showMessage("Reading your sleep from Health Connect…")
        refresh()

        // Keep the app current on its own.
        ensureNotificationPermission()
        scheduleUpdateChecks()
        maybeInstallFromIntent(intent)
        checkForUpdatesNow()
    }

    private fun refresh() {
        if (!health.available()) {
            showMessage(
                "Health Connect isn’t available on this phone.",
                "Install Health Connect from the Play Store, then in Garmin Connect go to Settings › Connected apps › Health Connect and turn on sleep, heart rate, steps and activities."
            )
            return
        }
        lifecycleScope.launch {
            if (!health.hasCorePermissions()) {
                showMessage("Slack needs to read your sleep from Health Connect.", "Tap Allow on the next screen. Nothing leaves your phone.")
                requestPermissions.launch(HealthData.PERMISSIONS)
                return@launch
            }
            try {
                val (js, nights) = withContext(Dispatchers.IO) { health.buildDataJs() }
                if (nights == 0) {
                    showMessage(
                        "No sleep found in Health Connect yet.",
                        "In Garmin Connect, open Settings › Connected apps › Health Connect and allow Sleep, Heart rate, Steps and Activities. Wear your watch tonight, sync in the morning, then reopen Slack."
                    )
                    return@launch
                }
                withContext(Dispatchers.IO) { dataFile.writeText(js) }
                showApp()
            } catch (e: Exception) {
                if (!dataFile.exists()) showMessage("Couldn’t read Health Connect.", e.message ?: e.toString())
            }
        }
    }

    private fun showApp() {
        val url = "https://appassets.androidplatform.net/assets/web/index.html"
        if (web.url?.startsWith(url) == true) web.reload() else web.loadUrl(url)
    }

    private fun showMessage(title: String, body: String = "") {
        val html = """<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="margin:0;background:#000;color:#F2F5F9;font-family:system-ui,sans-serif;display:flex;
            min-height:100vh;align-items:center;justify-content:center;padding:32px;box-sizing:border-box">
            <div><h2 style="font-size:22px;margin:0 0 12px">${title}</h2>
            <p style="color:#A3AEBE;line-height:1.5;margin:0">${body}</p></div></body>"""
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    override fun onResume() {
        super.onResume()
        // Pick up last night's data when you come back to the app in the morning.
        if (::web.isInitialized && dataFile.exists() && System.currentTimeMillis() - dataFile.lastModified() > 30 * 60 * 1000) refresh()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        maybeInstallFromIntent(intent) // tapped the "update ready" notification
    }

    @Deprecated("Back navigation inside the web UI")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    // --- Self-update plumbing ---------------------------------------------------------------

    /** Register a periodic background check so updates reach the phone even between app opens. */
    private fun scheduleUpdateChecks() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val work = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(this)
            .enqueueUniquePeriodicWork(UPDATE_WORK, ExistingPeriodicWorkPolicy.KEEP, work)
    }

    /** Foreground check when the app is opened (throttled), so a fresh build is offered promptly. */
    private fun checkForUpdatesNow() {
        if (!Updater.shouldForegroundCheck(this)) return
        lifecycleScope.launch {
            val release = withContext(Dispatchers.IO) { Updater.latestRelease(this@MainActivity) } ?: return@launch
            if (!Updater.isNewer(release)) return@launch
            val apk = withContext(Dispatchers.IO) { Updater.download(this@MainActivity, release) } ?: return@launch
            Updater.notifyUpdate(this@MainActivity, release, apk)
        }
    }

    private fun maybeInstallFromIntent(intent: Intent?) {
        val path = intent?.getStringExtra(EXTRA_INSTALL_APK) ?: return
        intent.removeExtra(EXTRA_INSTALL_APK) // don't re-trigger on rotation/resume
        val apk = File(path)
        if (apk.exists()) Updater.install(this, apk)
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
