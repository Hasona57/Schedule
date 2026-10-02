class TimeFormatter {
  /// Formats a time string (e.g. "08:30", "14:30") to either 24-hour or 12-hour (AM/PM) format.
  static String format(String timeStr, {required bool is24Hour}) {
    if (timeStr.isEmpty) return '';
    if (is24Hour) {
      return timeStr;
    }
    try {
      final parts = timeStr.split(':');
      if (parts.isEmpty) return timeStr;
      final hour = int.parse(parts[0].trim());
      final min = parts.length > 1 ? int.parse(parts[1].trim()) : 0;
      final period = hour >= 12 ? 'PM' : 'AM';
      final h12 = (hour % 12 == 0) ? 12 : (hour % 12);
      final mStr = min.toString().padLeft(2, '0');
      return '$h12:$mStr $period';
    } catch (_) {
      return timeStr;
    }
  }

  /// Formats a start and end time range with the selected 12h/24h format.
  static String formatRange(String start, String end, {required bool is24Hour}) {
    final s = format(start, is24Hour: is24Hour);
    final e = format(end, is24Hour: is24Hour);
    return '$s – $e';
  }
}
