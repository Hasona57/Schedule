# 📱 Nile University Smart Timetable - Flutter Android Application

A standalone Flutter mobile application for **Nile University** students that syncs with PowerCampus, runs locally offline on your phone, performs **1-minute live schedule verification**, and rings **local alarms 15 minutes before every class**.

---

## ✨ Features

1. 🔐 **Direct PowerCampus Login**: Enter your student username & password to securely fetch your timetable.
2. ⚡ **1-Minute Automatic Sync**: Background loop verifies schedule every minute and updates alarms if classroom changes occur.
3. 🔔 **Local 15-Minute Phone Alarms**: Rings acoustic chime, vibrates device, and shows exact room and floor directions 15 minutes before every lecture, tutorial, and lab.
4. 📚 **Accurate 18-Credit Calculation**: Automatically sets 3 credits per course and 0 credits for ENGL002.
5. 📅 **Weekly Grid & Day Agenda**: Intuitive timetable navigation with building maps and instructor details.
6. 🌙 **Dark & Light Mode**: Curated high-contrast UI tailored for students.

---

## 🛠️ How to Build & Run the APK

### Requirements
- [Flutter SDK](https://docs.flutter.dev/get-started/install) (version 3.0+)
- Android Studio / Android SDK (API 26+)

### 1. Install Dependencies
```bash
cd flutter_app
flutter pub get
```

### 2. Build Release APK
```bash
flutter build apk --release
```
The compiled APK will be generated at:
`flutter_app/build/app/outputs/flutter-apk/app-release.apk`

### 3. Install on Connected Phone
```bash
flutter install
# or
adb install build/app/outputs/flutter-apk/app-release.apk
```
