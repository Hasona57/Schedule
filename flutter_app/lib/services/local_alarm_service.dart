import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz;
import 'package:timezone/timezone.dart' as tz;
import '../models/schedule_models.dart';

class LocalAlarmService {
  static final LocalAlarmService _instance = LocalAlarmService._internal();
  factory LocalAlarmService() => _instance;
  LocalAlarmService._internal();

  final FlutterLocalNotificationsPlugin _notificationsPlugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    try {
      tz.initializeTimeZones();
      try {
        tz.setLocalLocation(tz.getLocation('Africa/Cairo'));
      } catch (_) {
        // Fallback to local default location if Africa/Cairo is not bundled
      }
    } catch (_) {}

    const AndroidInitializationSettings initializationSettingsAndroid =
        AndroidInitializationSettings('@mipmap/ic_launcher');

    const DarwinInitializationSettings initializationSettingsDarwin =
        DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    const InitializationSettings initializationSettings = InitializationSettings(
      android: initializationSettingsAndroid,
      iOS: initializationSettingsDarwin,
    );

    await _notificationsPlugin.initialize(
      initializationSettings,
      onDidReceiveNotificationResponse: (NotificationResponse response) {
        // Handle notification click to open class room directions
      },
    );

    // Create high-importance notification channel for class alarms
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      'nu_class_alarms_channel',
      'Class Alarms (15-Min Reminder)',
      description: 'Urgent alarm 15 minutes before class with classroom and floor directions',
      importance: Importance.max,
      playSound: true,
      enableVibration: true,
      showBadge: true,
    );

    try {
      await _notificationsPlugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    } catch (_) {}

    _initialized = true;
  }

  /// Request runtime permissions on Android 13+ and iOS
  Future<bool> requestPermissions() async {
    try {
      final androidImpl = _notificationsPlugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      if (androidImpl != null) {
        final granted = await androidImpl.requestNotificationsPermission();
        return granted ?? false;
      }
    } catch (_) {}
    return true;
  }

  /// Schedule local notifications 15 minutes before all sessions in the schedule
  Future<void> scheduleAllClassAlarms(FullSchedule schedule) async {
    try {
      await init();
      await _notificationsPlugin.cancelAll(); // Clear previous schedule alarms
    } catch (_) {}

    int notificationId = 1000;

    for (final course in schedule.courses) {
      for (final session in course.sessions) {
        try {
          final parts = session.startTime.split(':');
          if (parts.length < 2) continue;
          final startH = int.tryParse(parts[0]) ?? 8;
          final startM = int.tryParse(parts[1]) ?? 30;

          // Calculate 15 minutes prior
          int alarmH = startH;
          int alarmM = startM - 15;
          if (alarmM < 0) {
            alarmM += 60;
            alarmH -= 1;
          }

          // Map Sunday (0) to DateTime.sunday (7), Monday (1) to DateTime.monday (1), etc.
          final targetWeekday = session.dayIndex == 0 ? DateTime.sunday : session.dayIndex;

          final scheduledDate = _nextInstanceOfWeekdayTime(targetWeekday, alarmH, alarmM);

          final title = '🔔 Class in 15 Mins: ${course.code} (${session.type})';
          final body = '📍 ${session.building}, ${session.floor}, ${session.room}\n'
              '🧭 ${session.directions}\n'
              '⏰ Starts at ${session.startTime} with ${session.instructor}';

          const notificationDetails = NotificationDetails(
            android: AndroidNotificationDetails(
              'nu_class_alarms_channel',
              'Class Alarms (15-Min Reminder)',
              channelDescription: 'Alarm 15 minutes before class',
              importance: Importance.max,
              priority: Priority.high,
              fullScreenIntent: true,
              playSound: true,
              enableVibration: true,
              styleInformation: BigTextStyleInformation(''),
            ),
            iOS: DarwinNotificationDetails(
              presentAlert: true,
              presentBadge: true,
              presentSound: true,
            ),
          );

          try {
            // Attempt exact alarm first
            await _notificationsPlugin.zonedSchedule(
              notificationId++,
              title,
              body,
              scheduledDate,
              notificationDetails,
              androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
              uiLocalNotificationDateInterpretation:
                  UILocalNotificationDateInterpretation.absoluteTime,
              matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
            );
          } catch (_) {
            // Gracefully fallback to inexact if exact alarm permission is missing
            try {
              await _notificationsPlugin.zonedSchedule(
                notificationId++,
                title,
                body,
                scheduledDate,
                notificationDetails,
                androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
                uiLocalNotificationDateInterpretation:
                    UILocalNotificationDateInterpretation.absoluteTime,
                matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
              );
            } catch (_) {}
          }
        } catch (_) {
          // Ignore individual session scheduling error
        }
      }
    }
  }

  /// Trigger immediate local test alarm on device
  Future<void> showTestAlarm() async {
    await init();
    const AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
      'nu_class_alarms_channel',
      'Class Alarms (15-Min Reminder)',
      channelDescription: 'Test Alarm Notification',
      importance: Importance.max,
      priority: Priority.high,
      fullScreenIntent: true,
      playSound: true,
      enableVibration: true,
      styleInformation: BigTextStyleInformation(
        '📚 PHY111 - Physics I (Lecture Sec 08)\n'
        '📍 Room F46 (Building 2, UB2, First Floor)\n'
        '🧭 Building 2 -> 1st Floor -> Room F46\n'
        '⏰ Time: 10:30 - 12:29 | Instructor: Yasser Mohamed Elbatawy',
      ),
    );

    const NotificationDetails details = NotificationDetails(
      android: androidDetails,
      iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true),
    );

    await _notificationsPlugin.show(
      9999,
      '🧪 Local Alarm: 15 Mins Before Class',
      'PHY111 Physics I in Room F46 (Building 2)',
      details,
    );
  }

  tz.TZDateTime _nextInstanceOfWeekdayTime(int targetWeekday, int hour, int minute) {
    final tz.TZDateTime now = tz.TZDateTime.now(tz.local);
    tz.TZDateTime scheduledDate =
        tz.TZDateTime(tz.local, now.year, now.month, now.day, hour, minute);

    while (scheduledDate.weekday != targetWeekday || scheduledDate.isBefore(now)) {
      scheduledDate = scheduledDate.add(const Duration(days: 1));
    }
    return scheduledDate;
  }
}
