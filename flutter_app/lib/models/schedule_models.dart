class StudentInfo {
  final String name;
  final String personId;
  final String academicPlan;
  final String term;
  final String gpa;
  final String advisor;
  final String campus;

  StudentInfo({
    required this.name,
    required this.personId,
    required this.academicPlan,
    required this.term,
    this.gpa = 'Freshman',
    this.advisor = 'Academic Advising Center',
    this.campus = 'Main Campus (Sheikh Zayed)',
  });

  static String formatUsername(String user) {
    if (user.isEmpty) return 'Nile University Student';
    final cleaned = user.replaceAll(RegExp(r'[^a-zA-Z0-9\.]'), '');
    final match = RegExp(r'^([a-zA-Z]+)\.([a-zA-Z]+)(\d*)$').firstMatch(cleaned);
    if (match != null) {
      final firstInitial = match.group(1)?.toUpperCase() ?? '';
      final lastName = match.group(2) ?? '';
      final capLastName = lastName.isNotEmpty ? lastName[0].toUpperCase() + lastName.substring(1).toLowerCase() : '';
      final num = match.group(3) ?? '';
      if (num.isNotEmpty) {
        return '$firstInitial. $capLastName ($num)';
      }
      return '$firstInitial. $capLastName';
    }
    return user;
  }

  factory StudentInfo.fromJson(Map<String, dynamic> json) {
    final rawName = json['name']?.toString().trim();
    final rawUser = json['username']?.toString().trim() ?? '';
    final nameVal = (rawName != null && rawName.isNotEmpty && rawName != 'Nile University Student' && rawName != 'Hazem Mohamed')
        ? rawName
        : (rawUser.isNotEmpty ? formatUsername(rawUser) : (rawName ?? 'Nile University Student'));

    return StudentInfo(
      name: nameVal,
      personId: json['personId']?.toString() ?? '',
      academicPlan: json['academicPlan'] ?? json['program'] ?? 'Computer Science & Engineering',
      term: json['term'] ?? 'Fall 2026',
      gpa: json['gpa'] ?? 'Freshman',
      advisor: json['advisor'] ?? 'Academic Advising Center',
      campus: json['campus'] ?? 'Main Campus (Sheikh Zayed)',
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    'personId': personId,
    'academicPlan': academicPlan,
    'term': term,
    'gpa': gpa,
    'advisor': advisor,
    'campus': campus,
  };
}

class Session {
  final String id;
  final String type; // Lecture, Tutorial, Lab
  final String section;
  final int dayIndex; // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday
  final String dayName;
  final String startTime;
  final String endTime;
  final String room;
  final String floor;
  final String building;
  final String instructor;
  final String directions;

  Session({
    required this.id,
    required this.type,
    required this.section,
    required this.dayIndex,
    required this.dayName,
    required this.startTime,
    required this.endTime,
    required this.room,
    required this.floor,
    required this.building,
    required this.instructor,
    required this.directions,
  });

  factory Session.fromJson(Map<String, dynamic> json) {
    return Session(
      id: json['id'] ?? '',
      type: json['type'] ?? 'Lecture',
      section: json['section']?.toString() ?? '01',
      dayIndex: json['dayIndex'] is int ? json['dayIndex'] : int.tryParse(json['dayIndex']?.toString() ?? '0') ?? 0,
      dayName: json['dayName'] ?? 'Sunday',
      startTime: json['startTime'] ?? '08:30',
      endTime: json['endTime'] ?? '10:29',
      room: json['room'] ?? 'Room 101',
      floor: json['floor'] ?? 'Ground Floor',
      building: json['building'] ?? 'Building 1 (UB1)',
      instructor: json['instructor'] ?? 'Staff',
      directions: json['directions'] ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'section': section,
    'dayIndex': dayIndex,
    'dayName': dayName,
    'startTime': startTime,
    'endTime': endTime,
    'room': room,
    'floor': floor,
    'building': building,
    'instructor': instructor,
    'directions': directions,
  };
}

class Course {
  final String code;
  final String title;
  final int credits;
  final String color;
  final List<Session> sessions;

  Course({
    required this.code,
    required this.title,
    required this.credits,
    required this.color,
    required this.sessions,
  });

  factory Course.fromJson(Map<String, dynamic> json) {
    final rawCredits = json['credits'];
    int creditsVal = (json['code'] == 'ENGL002') ? 0 : 3;
    if (rawCredits != null && json['code'] != 'ENGL002') {
      creditsVal = int.tryParse(rawCredits.toString()) ?? 3;
    }

    final rawSessions = json['sessions'] as List? ?? [];
    return Course(
      code: json['code'] ?? '',
      title: json['title'] ?? '',
      credits: creditsVal,
      color: json['color'] ?? '#3b82f6',
      sessions: rawSessions.map((s) => Session.fromJson(s as Map<String, dynamic>)).toList(),
    );
  }

  Map<String, dynamic> toJson() => {
    'code': code,
    'title': title,
    'credits': credits,
    'color': color,
    'sessions': sessions.map((s) => s.toJson()).toList(),
  };
}

class FullSchedule {
  final StudentInfo student;
  final List<Course> courses;
  final String lastSynced;
  final int totalCredits;

  FullSchedule({
    required this.student,
    required this.courses,
    required this.lastSynced,
  }) : totalCredits = courses.fold(0, (sum, c) => sum + c.credits);

  factory FullSchedule.fromJson(Map<String, dynamic> json) {
    final rawStudent = json['student'] as Map<String, dynamic>? ?? {};
    final rawCourses = json['courses'] as List? ?? [];
    return FullSchedule(
      student: StudentInfo.fromJson(rawStudent),
      courses: rawCourses.map((c) => Course.fromJson(c as Map<String, dynamic>)).toList(),
      lastSynced: json['lastSynced'] ?? DateTime.now().toIso8601String(),
    );
  }

  Map<String, dynamic> toJson() => {
    'student': student.toJson(),
    'courses': courses.map((c) => c.toJson()).toList(),
    'lastSynced': lastSynced,
    'totalCredits': totalCredits,
  };
}
