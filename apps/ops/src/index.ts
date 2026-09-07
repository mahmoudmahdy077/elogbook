/**
 * @elogbook/ops — isolated host manager (T09+).
 *
 * Boundary (see docs/upgrade/evidence/T09/threat-model.md): this package
 * owns bootstrap authentication, durable jobs, and the constrained
 * executor. It must never be imported by apps/web (the web artifact must
 * contain no Docker execution, host shell, or installation secrets).
 */
export * from './bootstrap-token.js';
