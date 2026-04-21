import { matchHeaders } from '../frontend/src/utils/telemetryUtils.js';

// Mock performance for Node.js
const performance = {
  now: () => {
    const hrTime = process.hrtime();
    return hrTime[0] * 1000 + hrTime[1] / 1000000;
  },
};

const runBenchmark = () => {
  console.log('🚀 Starting Phase 5 Performance Benchmark...');

  const headers = [
    'First Name',
    'Last Name',
    'DOB',
    'Email Address',
    'Jersey Size',
    'Medical Allergies',
    'Buddy',
    'Emergency Contact',
    'Preferred Position',
    'Skill Tier',
  ];

  const telemetryLogs = [{ payload: { selected: ['gotsport_legacy'] } }];

  const customSchema = {
    jersey_size: 'string',
    preferred_position: 'string',
    emergency_contact: 'string',
  };

  // 1. Accuracy Verification
  console.log('\n🔍 Accuracy Verification:');
  const initialMatch = matchHeaders(headers, telemetryLogs, customSchema);
  console.log(`- Total Headers: ${headers.length}`);
  console.log(`- Mappings Created: ${Object.keys(initialMatch.mappings).length}`);

  const jerseyMatch = initialMatch.mappings['Jersey Size'];
  console.log(`- 'Jersey Size' -> '${jerseyMatch}' (Expected: 'jersey_size')`);
  if (jerseyMatch !== 'jersey_size') console.error('❌ Accuracy Fail: Jersey Size match failed');

  // 2. Performance Stress Test
  console.log('\n⚡ Performance Stress Test (1000 iterations):');
  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    matchHeaders(headers, telemetryLogs, customSchema);
  }
  const end = performance.now();
  const avgTime = (end - start) / iterations;

  console.log(`- Average Execution Time: ${avgTime.toFixed(4)}ms`);
  console.log(`- Governance Limit: 50.00ms`);
  console.log(`- Status: ${avgTime < 15 ? '✅ EXCELLENT' : avgTime < 50 ? '✅ PASS' : '❌ FAIL'}`);

  // 3. Circuit Breaker Simulation (Stress Test: 1,000+ headers)
  console.log('\n🌩️ Circuit Breaker & Stress Test (1,200 headers):');
  const massiveHeaders = Array.from({ length: 1200 }, (_, i) => `Unknown Header ${i}`);
  const cbStart = performance.now();
  const cbResult = matchHeaders(massiveHeaders, telemetryLogs, customSchema);
  const cbEnd = performance.now();

  console.log(`- Processed ${massiveHeaders.length} headers`);
  console.log(
    `- Ingestion Status: ${cbResult.isFallback ? '⚠️ FALLBACK ACTIVE (Circuit Breaker Tripped)' : '✅ PROCESSED'}`
  );
  console.log(`- Total Time: ${(cbEnd - cbStart).toFixed(2)}ms`);

  if (!cbResult.isFallback && cbEnd - cbStart > 50) {
    console.error('❌ FAIL: Circuit breaker failed to trip at 50ms');
  } else if (cbResult.isFallback) {
    console.log('✅ PASS: Circuit breaker successfully protected UI responsiveness.');
  }

  // 4. Core Immortality (Reserved Keys)
  console.log('\n🛡️ Core Immortality (Reserved Keys) Protection:');
  const reservedHeader = 'email'; // This is in RESERVED_KEYS
  const reservedTest = matchHeaders([reservedHeader], [], customSchema);
  const mapping = reservedTest.mappings[reservedHeader];
  const conf = reservedTest.confidence[reservedHeader];

  console.log(`- Input: '${reservedHeader}'`);
  console.log(`- Mapping Result: '${mapping}'`);
  console.log(`- Confidence: ${conf}`);

  if (mapping === 'email' && conf === 1.0) {
    console.log('✅ PASS: Reserved key protection is active.');
  } else {
    console.error('❌ FAIL: Reserved key was shadowed or matched with low confidence.');
  }
};

try {
  runBenchmark();
} catch (err) {
  console.error('Benchmark Error:', err);
}
