import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'models/schedule_models.dart';
import 'screens/login_screen.dart';
import 'screens/main_schedule_screen.dart';
import 'services/local_alarm_service.dart';
import 'services/powercampus_sync_service.dart';
import 'services/storage_service.dart';
import 'theme/app_theme.dart';

final ValueNotifier<ThemeMode> themeNotifier = ValueNotifier<ThemeMode>(ThemeMode.dark);
final ValueNotifier<bool> timeFormat24Notifier = ValueNotifier<bool>(false); // Default to 12-hour (false) or 24-hour (true)

void toggleAppTheme() async {
  final newMode = themeNotifier.value == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
  themeNotifier.value = newMode;
  await StorageService.setDarkMode(newMode == ThemeMode.dark);
}

void toggleTimeFormat() async {
  final newVal = !timeFormat24Notifier.value;
  timeFormat24Notifier.value = newVal;
  await StorageService.set24HourTime(newVal);
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Set preferred orientations
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Initialize local notifications and alarm manager
  final alarmService = LocalAlarmService();
  await alarmService.init();

  // Load saved theme and time format preferences
  final isDark = await StorageService.isDarkMode();
  themeNotifier.value = isDark ? ThemeMode.dark : ThemeMode.light;

  final is24 = await StorageService.is24HourTime();
  timeFormat24Notifier.value = is24;

  // Check saved schedule cache
  final savedSchedule = await StorageService.getSchedule();
  final creds = await StorageService.getCredentials();

  if (savedSchedule != null && creds != null) {
    PowerCampusSyncService.start1MinuteSyncLoop();
    await alarmService.scheduleAllClassAlarms(savedSchedule);
  }

  runApp(NUSmartScheduleApp(initialSchedule: savedSchedule));
}

class NUSmartScheduleApp extends StatelessWidget {
  final FullSchedule? initialSchedule;

  const NUSmartScheduleApp({super.key, this.initialSchedule});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: themeNotifier,
      builder: (context, currentMode, _) {
        return MaterialApp(
          title: 'Nile University Schedule',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.lightTheme,
          darkTheme: AppTheme.darkTheme,
          themeMode: currentMode,
          home: initialSchedule != null
              ? MainScheduleScreen(initialSchedule: initialSchedule!)
              : const LoginScreen(),
        );
      },
    );
  }
}
