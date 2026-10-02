import 'package:flutter_test/flutter_test.dart';
import 'package:nu_smart_schedule/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const NUSmartScheduleApp());
    expect(find.byType(NUSmartScheduleApp), findsOneWidget);
  });
}
