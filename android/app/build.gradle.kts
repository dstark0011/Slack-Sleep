plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The phone app reuses the web UI in ../../web, copied into the APK's assets at build time.
val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("../web"))
    into(layout.buildDirectory.dir("generated/webassets/web"))
}

// Version comes from CI (the Actions run number) so each build is newer than the last and
// the in-app updater can tell when a new release is available. Falls back to 1 for local builds.
val ciVersionCode = (System.getenv("VERSION_CODE")?.toIntOrNull()) ?: 1
val ciVersionName = System.getenv("VERSION_NAME") ?: "dev-$ciVersionCode"

// Where the updater looks for new builds (GitHub releases of this repo).
val releaseRepo = "dstark0011/slack-sleep"

android {
    namespace = "com.dave.slack"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dave.slack"
        minSdk = 28
        targetSdk = 34
        versionCode = ciVersionCode
        versionName = ciVersionName

        buildConfigField("String", "RELEASE_REPO", "\"$releaseRepo\"")
    }

    signingConfigs {
        // Fixed debug key so each new APK installs over the last one (keeps your journal tags).
        getByName("debug") {
            storeFile = file("slack-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))

    buildFeatures {
        buildConfig = true // exposes VERSION_CODE / RELEASE_REPO to the updater
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.health.connect:connect-client:1.1.0-alpha11")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.work:work-runtime-ktx:2.9.1") // periodic background update check
}
