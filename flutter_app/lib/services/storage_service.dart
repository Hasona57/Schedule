import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/schedule_models.dart';

class StorageService {
  static const String _keySchedule = 'nu_schedule_cache';
  static const String _keyUsername = 'nu_student_user';
  static const String _keyPassword = 'nu_student_pass';
  static const String _keyAlarm15Min = 'nu_alarm_15min_enabled';
  static const String _keySoundEnabled = 'nu_sound_enabled';
  static const String _keyDarkMode = 'nu_dark_mode';
  static const String _key24HourTime = 'nu_24hour_time';

  static Future<void> saveSchedule(FullSchedule schedule) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keySchedule, jsonEncode(schedule.toJson()));
  }

  static Future<FullSchedule?> getSchedule() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_keySchedule);
    if (raw == null) return null;
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      return FullSchedule.fromJson(json);
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveCredentials(String username, String password) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyUsername, username);
    await prefs.setString(_keyPassword, password);
  }

  static Future<Map<String, String>?> getCredentials() async {
    final prefs = await SharedPreferences.getInstance();
    final u = prefs.getString(_keyUsername);
    final p = prefs.getString(_keyPassword);
    if (u != null && p != null && u.isNotEmpty) {
      return {'username': u, 'password': p};
    }
    return null;
  }

  static Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
  }

  static Future<bool> isAlarm15MinEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_keyAlarm15Min) ?? true;
  }

  static Future<void> setAlarm15MinEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyAlarm15Min, enabled);
  }

  static Future<bool> isSoundEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_keySoundEnabled) ?? true;
  }

  static Future<void> setSoundEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keySoundEnabled, enabled);
  }

  static Future<bool> isDarkMode() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_keyDarkMode) ?? true;
  }

  static Future<void> setDarkMode(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyDarkMode, enabled);
  }

  static Future<bool> is24HourTime() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_key24HourTime) ?? false; // Default to 12-hour format or 24-hour toggleable
  }

  static Future<void> set24HourTime(bool is24) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_key24HourTime, is24);
  }
}
