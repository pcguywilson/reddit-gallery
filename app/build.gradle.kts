plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.pcguywilson.redditgallery"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.pcguywilson.redditgallery"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // Fixed personal key so every build installs over the previous one (keeps your feed list).
    signingConfigs {
        create("personal") {
            storeFile = file("release.keystore")
            storePassword = "redditgallery"
            keyAlias = "redditgallery"
            keyPassword = "redditgallery"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("personal")
        }
        debug {
            signingConfig = signingConfigs.getByName("personal")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.drawerlayout:drawerlayout:1.2.0")
    implementation("androidx.preference:preference-ktx:1.2.1")
}
