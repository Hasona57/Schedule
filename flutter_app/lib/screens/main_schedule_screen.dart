import 'dart:async';
import 'package:flutter/material.dart';
import '../models/schedule_models.dart';
import '../services/powercampus_sync_service.dart';
import '../services/storage_service.dart';
import '../services/local_alarm_service.dart';
import '../utils/time_formatter.dart';
import '../main.dart';
import 'class_detail_sheet.dart';
import 'login_screen.dart';

class MainScheduleScreen extends StatefulWidget {
  final FullSchedule initialSchedule;

  const MainScheduleScreen({super.key, required this.initialSchedule});

  @override
  State<MainScheduleScreen> createState() => _MainScheduleScreenState();
}

class _MainScheduleScreenState extends State<MainScheduleScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late FullSchedule _schedule;
  Timer? _uiRefreshTimer;

  int _selectedGridDay = DateTime.now().weekday == DateTime.friday || DateTime.now().weekday == DateTime.saturday
      ? 0
      : (DateTime.now().weekday == DateTime.sunday ? 0 : DateTime.now().weekday);

  int _selectedAgendaDay = DateTime.now().weekday == DateTime.friday || DateTime.now().weekday == DateTime.saturday
      ? 0
      : (DateTime.now().weekday == DateTime.sunday ? 0 : DateTime.now().weekday);

  bool _isWeeklyMatrixMode = false;
  bool _isSyncing = false;
  bool _alarm15MinEnabled = true;
  bool _soundEnabled = true;

  final List<String> _days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

  final List<String> _timeSlots = [
    '08:30', '09:30', '10:30', '11:30', '12:30',
    '13:30', '14:30', '15:30', '16:30', '17:30'
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _schedule = widget.initialSchedule;
    _loadSettings();

    // 1-minute live ticker for real-time countdown and active class highlight
    _uiRefreshTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) {
        setState(() {});
      }
    });
  }

  Future<void> _loadSettings() async {
    final alarm = await StorageService.isAlarm15MinEnabled();
    final sound = await StorageService.isSoundEnabled();
    setState(() {
      _alarm15MinEnabled = alarm;
      _soundEnabled = sound;
    });
  }

  @override
  void dispose() {
    _uiRefreshTimer?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _manualSync() async {
    setState(() => _isSyncing = true);
    final creds = await StorageService.getCredentials();
    if (creds == null || (creds['username'] ?? '').isEmpty) {
      setState(() => _isSyncing = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('⚠️ No student credentials found. Please log in again.'),
            backgroundColor: Color(0xFFF59E0B),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
      return;
    }

    try {
      final newSchedule = await PowerCampusSyncService.syncFromPowerCampus(
        creds['username']!,
        creds['password'] ?? '',
      );
      await StorageService.saveSchedule(newSchedule);

      try {
        await LocalAlarmService().scheduleAllClassAlarms(newSchedule);
      } catch (alarmErr) {
        debugPrint('Alarm sync notice: $alarmErr');
      }

      if (mounted) {
        setState(() {
          _schedule = newSchedule;
          _isSyncing = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✅ Timetable synchronized successfully with Nile University portal!'),
            backgroundColor: Color(0xFF10B981),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSyncing = false);
        String cleanMsg = e.toString().replaceFirst('Exception: ', '');
        if (cleanMsg.length > 120) {
          cleanMsg = '${cleanMsg.substring(0, 120)}...';
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('⚠️ Sync notice: $cleanMsg'),
            backgroundColor: const Color(0xFFF59E0B),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  void _openDetail(Course course, Session session, bool is24Hour) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ClassDetailSheet(course: course, session: session, is24Hour: is24Hour),
    );
  }

  Color _hexToColor(String hex) {
    try {
      final clean = hex.replaceFirst('#', '');
      return Color(int.parse('FF$clean', radix: 16));
    } catch (_) {
      return const Color(0xFF2563EB);
    }
  }

  int _parseTimeToMinutes(String timeStr) {
    try {
      final parts = timeStr.split(':');
      final h = int.parse(parts[0].trim());
      final m = int.parse(parts[1].trim());
      return h * 60 + m;
    } catch (_) {
      return 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return ValueListenableBuilder<bool>(
      valueListenable: timeFormat24Notifier,
      builder: (context, is24Hour, _) {
        return Scaffold(
          appBar: AppBar(
            title: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                  ),
                  child: ClipOval(
                    child: Image.asset(
                      'assets/images/nu_logo.png',
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF2563EB),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Center(
                          child: Text('NU', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'NU Timetable',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        _schedule.student.name,
                        style: TextStyle(
                          fontSize: 11,
                          color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              IconButton(
                icon: Icon(is24Hour ? Icons.timer_outlined : Icons.access_time),
                tooltip: is24Hour ? 'Switch to 12-Hour AM/PM' : 'Switch to 24-Hour Clock',
                onPressed: toggleTimeFormat,
              ),
              IconButton(
                icon: Icon(isDark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
                tooltip: isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode',
                onPressed: toggleAppTheme,
              ),
              IconButton(
                icon: _isSyncing
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh_rounded),
                tooltip: 'Sync with PowerCampus',
                onPressed: _isSyncing ? null : _manualSync,
              ),
            ],
            bottom: TabBar(
              controller: _tabController,
              indicatorColor: const Color(0xFF2563EB),
              indicatorWeight: 3,
              labelColor: const Color(0xFF2563EB),
              unselectedLabelColor: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
              tabs: const [
                Tab(icon: Icon(Icons.grid_view_rounded, size: 20), text: 'Grid & Gaps'),
                Tab(icon: Icon(Icons.calendar_today_rounded, size: 20), text: 'Agenda'),
                Tab(icon: Icon(Icons.book_outlined, size: 20), text: 'Courses'),
                Tab(icon: Icon(Icons.settings_outlined, size: 20), text: 'Settings'),
              ],
            ),
          ),
          body: TabBarView(
            controller: _tabController,
            children: [
              _buildGridView(theme, isDark, is24Hour),
              _buildAgendaView(theme, isDark, is24Hour),
              _buildCoursesView(theme, isDark, is24Hour),
              _buildSettingsView(theme, isDark, is24Hour),
            ],
          ),
        );
      },
    );
  }

  // 1. Grid & Gap Visualization View
  Widget _buildGridView(ThemeData theme, bool isDark, bool is24Hour) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildLiveHeroCard(theme, isDark, is24Hour),
          const SizedBox(height: 14),

          // View Mode Selector: Day Timeline & Gaps VS Weekly Matrix
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF131B2E) : const Color(0xFFE2E8F0),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => setState(() => _isWeeklyMatrixMode = false),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: !_isWeeklyMatrixMode ? const Color(0xFF2563EB) : Colors.transparent,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Center(
                        child: Text(
                          '📅 Day Timeline & Gaps',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: !_isWeeklyMatrixMode ? Colors.white : (isDark ? Colors.white70 : Colors.black87),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => setState(() => _isWeeklyMatrixMode = true),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: _isWeeklyMatrixMode ? const Color(0xFF2563EB) : Colors.transparent,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Center(
                        child: Text(
                          '📊 Full Weekly Matrix',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: _isWeeklyMatrixMode ? Colors.white : (isDark ? Colors.white70 : Colors.black87),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          if (!_isWeeklyMatrixMode)
            _buildDayTimelineWithGaps(theme, isDark, is24Hour)
          else
            _buildWeeklyMatrixGrid(theme, isDark, is24Hour),
        ],
      ),
    );
  }

  // 1A. Day Timeline & Gap Visualizer
  Widget _buildDayTimelineWithGaps(ThemeData theme, bool isDark, bool is24Hour) {
    // Collect and sort sessions for selected day
    final daySessions = <MapEntry<Course, Session>>[];
    for (final c in _schedule.courses) {
      for (final s in c.sessions) {
        if (s.dayIndex == _selectedGridDay) {
          daySessions.add(MapEntry(c, s));
        }
      }
    }
    daySessions.sort((a, b) => a.value.startTime.compareTo(b.value.startTime));

    // Calculate total class hours and total gap minutes
    int totalGapMins = 0;
    for (int i = 0; i < daySessions.length - 1; i++) {
      final prevEnd = _parseTimeToMinutes(daySessions[i].value.endTime);
      final nextStart = _parseTimeToMinutes(daySessions[i + 1].value.startTime);
      if (nextStart > prevEnd) {
        totalGapMins += (nextStart - prevEnd);
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Day selector chips
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: List.generate(_days.length, (idx) {
              final isSelected = _selectedGridDay == idx;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(_days[idx]),
                  selected: isSelected,
                  selectedColor: const Color(0xFF2563EB),
                  labelStyle: TextStyle(
                    color: isSelected ? Colors.white : null,
                    fontWeight: FontWeight.bold,
                  ),
                  onSelected: (selected) {
                    if (selected) setState(() => _selectedGridDay = idx);
                  },
                ),
              );
            }),
          ),
        ),
        const SizedBox(height: 12),

        // Day Summary Banner
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF131B2E) : const Color(0xFFF1F5F9),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${_days[_selectedGridDay]} Schedule',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
              ),
              Text(
                '${daySessions.length} Classes${totalGapMins > 0 ? ' • ${totalGapMins ~/ 60 > 0 ? '${totalGapMins ~/ 60}h ' : ''}${totalGapMins % 60 > 0 ? '${totalGapMins % 60}m' : ''} Gap' : ''}',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        if (daySessions.isEmpty)
          Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF131B2E) : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0)),
            ),
            child: const Column(
              children: [
                Text('🌴', style: TextStyle(fontSize: 36)),
                SizedBox(height: 8),
                Text('Free Day! No Classes Today', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                SizedBox(height: 4),
                Text('Enjoy your free academic study time or library work.', style: TextStyle(fontSize: 12, color: Colors.grey), textAlign: TextAlign.center),
              ],
            ),
          )
        else
          ...List.generate(daySessions.length, (idx) {
            final entry = daySessions[idx];
            final course = entry.key;
            final session = entry.value;
            final color = _hexToColor(course.color);

            Widget? gapCard;
            if (idx > 0) {
              final prevSession = daySessions[idx - 1].value;
              final prevEndMins = _parseTimeToMinutes(prevSession.endTime);
              final curStartMins = _parseTimeToMinutes(session.startTime);
              final gapMins = curStartMins - prevEndMins;

              if (gapMins >= 10) {
                final gapHours = gapMins ~/ 60;
                final gapRemainder = gapMins % 60;
                final durationStr = '${gapHours > 0 ? '$gapHours hr ' : ''}${gapRemainder > 0 ? '$gapRemainder mins' : ''}'.trim();
                final gapRangeStr = TimeFormatter.formatRange(prevSession.endTime, session.startTime, is24Hour: is24Hour);

                gapCard = Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF1E1B18) : const Color(0xFFFFFBEB),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: const Color(0xFFF59E0B).withOpacity(0.4),
                      style: BorderStyle.solid,
                      width: 1.5,
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF59E0B).withOpacity(0.2),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.coffee_outlined, color: Color(0xFFF59E0B), size: 20),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text(
                                  '☕ Free Period (Gap)',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                    color: Color(0xFFD97706),
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF59E0B).withOpacity(0.15),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    durationStr,
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFD97706)),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              gapRangeStr,
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Free time on campus • Study, campus cafeteria, or library',
                              style: TextStyle(
                                fontSize: 11,
                                color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF78350F),
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }
            }

            final classCard = Card(
              margin: const EdgeInsets.only(bottom: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              color: isDark ? const Color(0xFF131B2E) : Colors.white,
              elevation: 2,
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () => _openDetail(course, session, is24Hour),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: color.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(color: color.withOpacity(0.3)),
                            ),
                            child: Text(
                              course.code,
                              style: TextStyle(
                                color: color,
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Flexible(
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.grey.withOpacity(0.12),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                '${session.type} • Sec ${session.section}',
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            TimeFormatter.formatRange(session.startTime, session.endTime, is24Hour: is24Hour),
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                              color: Color(0xFF2563EB),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),

                      Text(
                        course.title,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 10),

                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined, size: 16, color: Color(0xFF2563EB)),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              '${session.room} (${session.building})',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 8),
                          const Icon(Icons.person_outline, size: 16, color: Colors.grey),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              session.instructor,
                              style: TextStyle(
                                fontSize: 12,
                                color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textAlign: TextAlign.end,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );

            if (gapCard != null) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [gapCard, classCard],
              );
            }
            return classCard;
          }),
      ],
    );
  }

  // 1B. Full Weekly Matrix Grid Table with Merged Multi-Hour Classes
  Widget _buildWeeklyMatrixGrid(ThemeData theme, bool isDark, bool is24Hour) {
    const double slotHeight = 72.0;
    const double colWidth = 125.0;
    const double timeColWidth = 75.0;
    const int baseMins = 8 * 60 + 30; // 08:30 = 510 minutes
    final double totalGridHeight = _timeSlots.length * slotHeight;

    return Container(
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF131B2E) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header Row (TIME + Days)
            Container(
              decoration: BoxDecoration(
                color: isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: Row(
                children: [
                  Container(
                    width: timeColWidth,
                    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
                    alignment: Alignment.center,
                    child: const Text('TIME', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                  ),
                  ..._days.map((day) => Container(
                        width: colWidth,
                        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          border: Border(
                            left: BorderSide(
                              color: isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1),
                              width: 1,
                            ),
                          ),
                        ),
                        child: Text(
                          day.substring(0, 3).toUpperCase(),
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                        ),
                      )),
                ],
              ),
            ),

            // Grid Content: Time Column + 5 Day Columns with Positioned Merged Blocks
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Time Column
                SizedBox(
                  width: timeColWidth,
                  height: totalGridHeight,
                  child: Column(
                    children: _timeSlots.map((slot) {
                      return Container(
                        height: slotHeight,
                        padding: const EdgeInsets.all(4),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          border: Border(
                            top: BorderSide(
                              color: isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
                              width: 1,
                            ),
                          ),
                        ),
                        child: Text(
                          TimeFormatter.format(slot, is24Hour: is24Hour),
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                          ),
                          textAlign: TextAlign.center,
                        ),
                      );
                    }).toList(),
                  ),
                ),

                // 5 Day Columns
                ...List.generate(_days.length, (dayIdx) {
                  // Collect sessions for this day
                  final daySessions = <MapEntry<Course, Session>>[];
                  for (final c in _schedule.courses) {
                    for (final s in c.sessions) {
                      if (s.dayIndex == dayIdx) {
                        daySessions.add(MapEntry(c, s));
                      }
                    }
                  }

                  return Container(
                    width: colWidth,
                    height: totalGridHeight,
                    decoration: BoxDecoration(
                      border: Border(
                        left: BorderSide(
                          color: isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
                          width: 1,
                        ),
                      ),
                    ),
                    child: Stack(
                      children: [
                        // Background grid slots with Free markers
                        Column(
                          children: List.generate(_timeSlots.length, (slotIdx) {
                            return Container(
                              height: slotHeight,
                              decoration: BoxDecoration(
                                border: Border(
                                  top: BorderSide(
                                    color: isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
                                    width: 1,
                                  ),
                                ),
                              ),
                              child: Center(
                                child: Text(
                                  'Free',
                                  style: TextStyle(
                                    fontSize: 10,
                                    color: isDark ? const Color(0xFF334155).withOpacity(0.6) : const Color(0xFFCBD5E1),
                                  ),
                                ),
                              ),
                            );
                          }),
                        ),

                        // Positioned merged class cards spanning full 1h, 2h, or 3h duration
                        ...daySessions.map((entry) {
                          final course = entry.key;
                          final session = entry.value;
                          final color = _hexToColor(course.color);

                          final sStart = _parseTimeToMinutes(session.startTime);
                          final sEnd = _parseTimeToMinutes(session.endTime);

                          final topOffset = ((sStart - baseMins) / 60.0) * slotHeight;
                          final durationHours = (sEnd - sStart) / 60.0;
                          final blockHeight = (durationHours * slotHeight) - 4.0;

                          final clampedTop = topOffset < 0 ? 0.0 : topOffset;
                          final clampedHeight = blockHeight < 36.0 ? 36.0 : blockHeight;

                          return Positioned(
                            top: clampedTop + 2.0,
                            height: clampedHeight,
                            left: 3.0,
                            right: 3.0,
                            child: InkWell(
                              onTap: () => _openDetail(course, session, is24Hour),
                              borderRadius: BorderRadius.circular(10),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                                decoration: BoxDecoration(
                                  color: color.withOpacity(0.18),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: color.withOpacity(0.6), width: 1.5),
                                  boxShadow: [
                                    BoxShadow(
                                      color: color.withOpacity(0.1),
                                      blurRadius: 4,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${course.code} (${session.type})',
                                            style: TextStyle(
                                              color: color,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 11,
                                            ),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      course.title,
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w600,
                                        color: isDark ? Colors.white : Colors.black87,
                                      ),
                                      maxLines: durationHours >= 1.7 ? 2 : 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 2),
                                    Row(
                                      children: [
                                        const Icon(Icons.location_on, size: 10, color: Color(0xFF2563EB)),
                                        const SizedBox(width: 2),
                                        Expanded(
                                          child: Text(
                                            session.room,
                                            style: TextStyle(
                                              fontSize: 10,
                                              color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF475569),
                                              fontWeight: FontWeight.w500,
                                            ),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                      ],
                                    ),
                                    if (durationHours >= 1.7) ...[
                                      const SizedBox(height: 2),
                                      Text(
                                        TimeFormatter.formatRange(session.startTime, session.endTime, is24Hour: is24Hour),
                                        style: TextStyle(
                                          fontSize: 9,
                                          fontWeight: FontWeight.bold,
                                          color: color,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                          );
                        }),
                      ],
                    ),
                  );
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // 2. Day Agenda View
  Widget _buildAgendaView(ThemeData theme, bool isDark, bool is24Hour) {
    final daySessions = <MapEntry<Course, Session>>[];
    for (final c in _schedule.courses) {
      for (final s in c.sessions) {
        if (s.dayIndex == _selectedAgendaDay) {
          daySessions.add(MapEntry(c, s));
        }
      }
    }
    daySessions.sort((a, b) => a.value.startTime.compareTo(b.value.startTime));

    return Column(
      children: [
        // Day selector pills
        Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: List.generate(_days.length, (idx) {
                final isSelected = _selectedAgendaDay == idx;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(_days[idx]),
                    selected: isSelected,
                    selectedColor: const Color(0xFF2563EB),
                    labelStyle: TextStyle(
                      color: isSelected ? Colors.white : null,
                      fontWeight: FontWeight.bold,
                    ),
                    onSelected: (selected) {
                      if (selected) setState(() => _selectedAgendaDay = idx);
                    },
                  ),
                );
              }),
            ),
          ),
        ),
        Expanded(
          child: daySessions.isEmpty
              ? const Center(child: Text('🎉 Free Day! No classes today.'))
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: daySessions.length,
                  itemBuilder: (context, idx) {
                    final entry = daySessions[idx];
                    final course = entry.key;
                    final session = entry.value;
                    final color = _hexToColor(course.color);

                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      color: isDark ? const Color(0xFF131B2E) : Colors.white,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(14),
                        onTap: () => _openDetail(course, session, is24Hour),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: color.withOpacity(0.15),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      course.code,
                                      style: TextStyle(
                                        color: color,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Flexible(
                                    child: Text(
                                      session.type,
                                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    TimeFormatter.formatRange(session.startTime, session.endTime, is24Hour: is24Hour),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Color(0xFF2563EB),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                course.title,
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  const Icon(Icons.location_on_outlined, size: 16, color: Colors.grey),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      '${session.room} (${session.building})',
                                      style: const TextStyle(fontSize: 12),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  const Icon(Icons.person_outline, size: 16, color: Colors.grey),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      session.instructor,
                                      style: const TextStyle(fontSize: 12),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      textAlign: TextAlign.end,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  // 3. Enrolled Courses View
  Widget _buildCoursesView(ThemeData theme, bool isDark, bool is24Hour) {
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        // Credits Banner
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF1E40AF), Color(0xFF3B82F6)],
            ),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Total Registered', style: TextStyle(color: Colors.white70, fontSize: 12)),
                  Text(
                    '${_schedule.totalCredits} Credit Hours',
                    style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              Text(
                '${_schedule.courses.length} Subjects',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        ..._schedule.courses.map((course) {
          final color = _hexToColor(course.color);
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            color: isDark ? const Color(0xFF131B2E) : Colors.white,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: color.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          course.code,
                          style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '${course.credits} Credits',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: course.credits == 0 ? Colors.grey : const Color(0xFF10B981),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    course.title,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 10),
                  const Divider(height: 1),
                  const SizedBox(height: 8),
                  ...course.sessions.map((s) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Text(
                              '• ${s.dayName.substring(0, 3)} ${TimeFormatter.formatRange(s.startTime, s.endTime, is24Hour: is24Hour)}',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                '${s.type} (${s.room})',
                                overflow: TextOverflow.ellipsis,
                                maxLines: 1,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B),
                                ),
                              ),
                            ),
                          ],
                        ),
                      )),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  // 4. Settings View
  Widget _buildSettingsView(ThemeData theme, bool isDark, bool is24Hour) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: isDark ? const Color(0xFF131B2E) : Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          child: Column(
            children: [
              SwitchListTile(
                secondary: const Icon(Icons.timer_outlined, color: Color(0xFF2563EB)),
                title: const Text('24-Hour Time Format'),
                subtitle: Text(is24Hour ? '24-Hour clock active (e.g. 14:30)' : '12-Hour clock active (e.g. 2:30 PM)'),
                value: is24Hour,
                activeColor: const Color(0xFF2563EB),
                onChanged: (_) => toggleTimeFormat(),
              ),
              const Divider(height: 1),
              SwitchListTile(
                secondary: Icon(isDark ? Icons.dark_mode_outlined : Icons.light_mode_outlined, color: const Color(0xFF2563EB)),
                title: const Text('Dark Mode Theme'),
                subtitle: Text(isDark ? 'Dark theme active (OLED/Battery saving)' : 'Light theme active (Clean high-contrast)'),
                value: isDark,
                activeColor: const Color(0xFF2563EB),
                onChanged: (_) => toggleAppTheme(),
              ),
              const Divider(height: 1),
              SwitchListTile(
                secondary: const Icon(Icons.alarm_on, color: Color(0xFF2563EB)),
                title: const Text('15-Minute Local Alarms'),
                subtitle: const Text('Rings phone alarm 15 minutes prior to every class'),
                value: _alarm15MinEnabled,
                activeColor: const Color(0xFF2563EB),
                onChanged: (val) async {
                  setState(() => _alarm15MinEnabled = val);
                  await StorageService.setAlarm15MinEnabled(val);
                  if (val) {
                    await LocalAlarmService().scheduleAllClassAlarms(_schedule);
                  }
                },
              ),
              const Divider(height: 1),
              SwitchListTile(
                secondary: const Icon(Icons.volume_up_outlined, color: Color(0xFF2563EB)),
                title: const Text('Alarm Audio Chime'),
                subtitle: const Text('Synthesized acoustic chime and vibration'),
                value: _soundEnabled,
                activeColor: const Color(0xFF2563EB),
                onChanged: (val) async {
                  setState(() => _soundEnabled = val);
                  await StorageService.setSoundEnabled(val);
                },
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        ElevatedButton.icon(
          onPressed: () async {
            await LocalAlarmService().showTestAlarm();
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('🔔 Test 15-Minute Alarm Triggered on Phone!'),
                  backgroundColor: Color(0xFF2563EB),
                ),
              );
            }
          },
          icon: const Icon(Icons.notifications_active),
          label: const Text('Trigger Test 15-Min Alarm Now'),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF2563EB),
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 16),

        ElevatedButton.icon(
          onPressed: _manualSync,
          icon: const Icon(Icons.sync),
          label: const Text('Sync with PowerCampus'),
          style: ElevatedButton.styleFrom(
            backgroundColor: isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0),
            foregroundColor: isDark ? Colors.white : Colors.black87,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 16),

        OutlinedButton.icon(
          onPressed: () async {
            await StorageService.clearAll();
            PowerCampusSyncService.stop1MinuteSyncLoop();
            if (mounted) {
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            }
          },
          icon: const Icon(Icons.logout, color: Colors.red),
          label: const Text('Log Out Student Account', style: TextStyle(color: Colors.red)),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 14),
            side: const BorderSide(color: Colors.red),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
      ],
    );
  }

  Map<String, dynamic> _getLiveClassStatus(bool is24Hour) {
    final now = DateTime.now();
    // Weekday: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4
    final currentDayIndex = now.weekday == DateTime.sunday ? 0 : (now.weekday <= 4 ? now.weekday : -1);
    final nowMinutes = now.hour * 60 + now.minute;

    if (currentDayIndex == -1) {
      return {
        'status': 'weekend',
        'title': 'Weekend (Off-Campus)',
        'subtitle': 'Next lectures resume on Sunday morning',
      };
    }

    final todaySessions = <MapEntry<Course, Session>>[];
    for (final c in _schedule.courses) {
      for (final s in c.sessions) {
        if (s.dayIndex == currentDayIndex) {
          todaySessions.add(MapEntry(c, s));
        }
      }
    }

    if (todaySessions.isEmpty) {
      return {
        'status': 'free_day',
        'title': '🎉 Free Day! No Classes Today',
        'subtitle': 'Enjoy your free academic study time',
      };
    }

    todaySessions.sort((a, b) => a.value.startTime.compareTo(b.value.startTime));

    // Check ongoing session
    for (final entry in todaySessions) {
      final s = entry.value;
      final startMin = _parseTimeToMinutes(s.startTime);
      final endMin = _parseTimeToMinutes(s.endTime);

      if (nowMinutes >= startMin && nowMinutes <= endMin) {
        final remaining = endMin - nowMinutes;
        return {
          'status': 'ongoing',
          'course': entry.key,
          'session': s,
          'title': '🟢 Ongoing: ${entry.key.code} (${s.type})',
          'subtitle': '📍 ${s.room} (${s.building}) • Ends in ${remaining}m',
        };
      }
    }

    // Check next upcoming session today
    for (final entry in todaySessions) {
      final s = entry.value;
      final startMin = _parseTimeToMinutes(s.startTime);

      if (nowMinutes < startMin) {
        final diff = startMin - nowMinutes;
        final startFormatted = TimeFormatter.format(s.startTime, is24Hour: is24Hour);
        return {
          'status': 'upcoming',
          'course': entry.key,
          'session': s,
          'title': '⏰ Next: ${entry.key.code} (${s.type}) at $startFormatted',
          'subtitle': '📍 ${s.room} (${s.building}) • Starts in ${diff}m (15-min alarm active)',
        };
      }
    }

    return {
      'status': 'finished',
      'title': '✅ All Classes Done for Today!',
      'subtitle': 'Great job today! Next classes resume tomorrow.',
    };
  }

  Widget _buildLiveHeroCard(ThemeData theme, bool isDark, bool is24Hour) {
    final liveStatus = _getLiveClassStatus(is24Hour);
    final now = DateTime.now();
    final timeStr = is24Hour
        ? '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}'
        : '${(now.hour % 12 == 0 ? 12 : now.hour % 12)}:${now.minute.toString().padLeft(2, '0')} ${now.hour >= 12 ? 'PM' : 'AM'}';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF2563EB), Color(0xFF06B6D4)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF2563EB).withOpacity(0.3),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.radar, size: 14, color: Colors.white),
                    const SizedBox(width: 4),
                    Text('Live Monitor • $timeStr', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
              const Text('1-Min Active ⚡', style: TextStyle(color: Colors.white70, fontSize: 11)),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            liveStatus['title'] as String,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            liveStatus['subtitle'] as String,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.location_on, size: 13, color: Colors.white70),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  '${_schedule.student.campus} • ${_schedule.totalCredits} Credits',
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
