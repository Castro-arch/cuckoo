// The only module that imports temporal-polyfill (ADR-0002). Everything else imports
// Temporal from here, so switching to the native global later changes only this file.
export { Temporal } from 'temporal-polyfill';
