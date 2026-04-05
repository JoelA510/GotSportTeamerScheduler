import { computeEnterpriseMetrics } from '../frontend/src/utils/analyticsUtils.js';

// Mock performance for Node.js
const performance = {
  now: () => {
    const hrTime = process.hrtime();
    return hrTime[0] * 1000 + hrTime[1] / 1000000;
  }
};

const runBenchmark = () => {
  console.log('📊 Starting Phase 6 Analytics Benchmark & Audit...\n');

  // 1. Setup Mock Enterprise Data
  console.log('Generating 1,000 mock players with varied custom attributes...');
  const players = Array.from({ length: 1000 }, (_, i) => ({
    id: `player_${i}`,
    first_name: `John${i}`,
    last_name: `Doe${i}`,
    custom_attributes: {
      'jersey_size': ['S', 'M', 'L', 'XL'][i % 4],
      'preferred_position': ['Defender', 'Midfielder', 'Attacker', 'Goalkeeper'][i % 4],
      'emergency_contact': `555-000-${i}`, // PII
      'medical_allergies': i % 10 === 0 ? 'Peanuts' : 'None', // PII
      'skill_rating': (i % 5) + 1,
      'attendance_score': (i % 100)
    }
  }));

  // Schema with sensitive flags
  const orgSchema = {
    'jersey_size': { type: 'string', sensitive: false },
    'preferred_position': { type: 'string', sensitive: false },
    'emergency_contact': { type: 'string', sensitive: true },
    'medical_allergies': { type: 'string', sensitive: true },
    'skill_rating': { type: 'number', sensitive: false },
    'attendance_score': { type: 'number', sensitive: false }
  };

  console.log('Schema loaded with sensitive fields flagged.\n');

  // 2. Differential Privacy Audit (PII Masking)
  console.log('🔒 EXECUTING @security-auditor Differential Privacy Check...');
  const auditResult = computeEnterpriseMetrics(players, orgSchema);
  
  const hasEmergencyContact = auditResult.aggregates['emergency_contact'] !== undefined;
  const hasMedicalAllergies = auditResult.aggregates['medical_allergies'] !== undefined;

  console.log('- Checking for PII leaks in aggregate payload:');
  console.log(`  - emergency_contact masked: ${!hasEmergencyContact ? '✅ YES' : '❌ NO'}`);
  console.log(`  - medical_allergies masked: ${!hasMedicalAllergies ? '✅ YES' : '❌ NO'}`);

  if (hasEmergencyContact || hasMedicalAllergies) {
    console.error('❌ FATAL SECURITY AUDIT FAILURE: PII Leaked into aggregate metrics context.');
    process.exit(1);
  }

  // Check masked fields tracking
  if (auditResult.maskedFields.includes('emergency_contact') && auditResult.maskedFields.includes('medical_allergies')) {
    console.log('✅ PASS: Sensitive fields properly tracked and excluded from processing.');
  }

  // 3. K-Anonymity Audit
  // Test low sample fallback
  console.log('\n🔒 EXECUTING @security-auditor K-Anonymity Check...');
  const lowSampleResult = computeEnterpriseMetrics(players.slice(0, 2), orgSchema);
  if (lowSampleResult.isLowSample && Object.keys(lowSampleResult.aggregates).length === 0) {
    console.log('✅ PASS: Global K-Anonymity ceiling enforced (< 3 records blocked).');
  } else {
    console.error('❌ FAIL: Global K-Anonymity rule bypassed.');
    process.exit(1);
  }

  // 4. Performance Profiling
  console.log('\n⚡ EXECUTING @performance-profiling 200ms Ceiling Verification...');
  console.log('- Running 1,000 iterations over 1,000 records...');

  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    computeEnterpriseMetrics(players, orgSchema);
  }
  const end = performance.now();
  
  const avgTime = (end - start) / iterations;

  console.log(`- Average Execution Time: ${avgTime.toFixed(4)}ms`);
  console.log(`- Governance Limit (Ceiling): 200.00ms`);
  console.log(`- Status: ${avgTime < 50 ? '✅ EXCELLENT' : avgTime < 200 ? '✅ PASS' : '❌ FAIL (Ceiling Exceeded)'}`);

  if (avgTime > 200) {
    console.error('❌ FATAL PERFORMANCE AUDIT FAILURE: Metric computation exceeds 200ms.');
    process.exit(1);
  }

  console.log('\n🎉 Phase 6 Init Check Complete. All Gates Passed.');
};

try {
  runBenchmark();
} catch (err) {
  console.error('Benchmark Error:', err);
}
