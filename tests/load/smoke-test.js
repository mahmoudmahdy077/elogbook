// k6 load test — E-Logbook Enterprise
// Run: k6 run tests/load/smoke-test.js
// Install: brew install k6

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency');

const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.K6_TOKEN || 'placeholder-token';
const TENANT = 'demo';

export const options = {
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<2000'],
    errors: ['rate<0.01'],
  },
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
      tags: { scenario: 'smoke' },
    },
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 200 },
        { duration: '2m', target: 200 },
        { duration: '1m', target: 0 },
      ],
      startTime: '30s',
      tags: { scenario: 'load' },
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 1000 },
        { duration: '3m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      startTime: '4m',
      tags: { scenario: 'stress' },
    },
  },
};

function randomId() {
  return Math.random().toString(36).substring(2, 10);
}

export default function () {
  group('Health Check', () => {
    const res = http.get(`${BASE_URL}/api/health`, {
      tags: { endpoint: 'health' },
    });
    check(res, {
      'health status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    apiLatency.add(res.timings.duration);
    sleep(1);
  });

  group('Dashboard', () => {
    const res = http.get(`${BASE_URL}/api/${TENANT}/dashboard`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'dashboard' },
    });
    check(res, {
      'dashboard status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    apiLatency.add(res.timings.duration);
    sleep(2);
  });

  group('Cases List', () => {
    const res = http.get(`${BASE_URL}/api/${TENANT}/cases`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'cases' },
    });
    check(res, {
      'cases status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    apiLatency.add(res.timings.duration);
    sleep(2);
  });

  group('Approvals', () => {
    const res = http.post(
      `${BASE_URL}/api/${TENANT}/approvals/action`,
      JSON.stringify({
        entryId: randomId(),
        action: 'approve',
        note: 'Load test auto-approve',
      }),
      {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json',
          Origin: BASE_URL,
        },
        tags: { endpoint: 'approvals' },
      }
    );
    check(res, {
      'approvals responded': (r) => r.status === 200 || r.status === 429 || r.status === 403,
    });
    errorRate.add(res.status >= 500);
    apiLatency.add(res.timings.duration);
    sleep(3);
  });
}
