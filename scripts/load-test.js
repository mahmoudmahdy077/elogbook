/**
 * k6 load test script for SC-014 concurrency validation.
 * Run: k6 run scripts/load-test.js
 * Requires K6_HOST and K6_TOKEN environment variables.
 */

import http from 'k6/http';
import { check } from 'k6';

const HOST = __ENV.K6_HOST || 'http://localhost:3000';
const TOKEN = __ENV.K6_TOKEN || '';
const TENANT = __ENV.K6_TENANT || 'demo';

export const options = {
  stages: [
    { duration: '30s', target: 5000 },
    { duration: '1m', target: 5000 },
    { duration: '30s', target: 10000 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

export default function () {
  const endpoints = [
    `${HOST}/api/${TENANT}/cases`,
    `${HOST}/${TENANT}/dashboard`,
    `${HOST}/${TENANT}/approvals`,
  ];

  const url = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(url, { headers });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
