import type { AuditLogEntry, EnvironmentState, Flag, FlagServiceBinding, Service } from "../types";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function daysAhead(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

function env(enabled: boolean, updatedAt: string, updatedBy: string): EnvironmentState {
  return { enabled, updatedAt, updatedBy };
}

function binding(
  serviceId: string,
  readMode: FlagServiceBinding["readMode"],
  lastCheckInAt: string,
  driftSuspected = false,
  buildTimeValues?: FlagServiceBinding["buildTimeValues"],
): FlagServiceBinding {
  return { serviceId, readMode, lastCheckInAt, driftSuspected, buildTimeValues };
}

export const services: Service[] = [
  {
    id: "svc-evapl-service-frontend",
    key: "evapl-service-frontend",
    name: "evapl-service-frontend",
    registeredAt: daysAgo(120),
    registeredBy: "a.kowalska",
    hasCredential: true,
    credentialStatus: "active",
    credentialLastRotated: daysAgo(58),
    lastCheckInAt: hoursAgo(0.2),
  },
  {
    id: "svc-evam-service-host",
    key: "evam-service-host",
    name: "evam-service-host",
    registeredAt: daysAgo(120),
    registeredBy: "a.kowalska",
    hasCredential: true,
    credentialStatus: "active",
    credentialLastRotated: daysAgo(58),
    lastCheckInAt: hoursAgo(0.1),
  },
  {
    id: "svc-evboweb-service-bff",
    key: "evboweb-service-bff",
    name: "evboweb-service-bff",
    registeredAt: daysAgo(96),
    registeredBy: "m.chen",
    hasCredential: true,
    credentialStatus: "active",
    credentialLastRotated: daysAgo(12),
    lastCheckInAt: hoursAgo(0.5),
  },
  {
    id: "svc-evnm-service-charger-infrastructure",
    key: "evnm-service-charger-infrastructure",
    name: "evnm-service-charger-infrastructure",
    registeredAt: daysAgo(80),
    registeredBy: "j.novak",
    hasCredential: true,
    credentialStatus: "active",
    credentialLastRotated: daysAgo(80),
    lastCheckInAt: hoursAgo(1.8),
  },
  {
    id: "svc-evsim-service-sim-adapter",
    key: "evsim-service-sim-adapter",
    name: "evsim-service-sim-adapter",
    registeredAt: daysAgo(64),
    registeredBy: "r.singh",
    hasCredential: true,
    credentialStatus: "rotating",
    previousCredentialExpiresAt: hoursAgo(-18),
    credentialLastRotated: hoursAgo(6),
    lastCheckInAt: hoursAgo(60),
  },
];

export const flags: Flag[] = [
  {
    id: "flag-allowEvseNameEdit",
    key: "allowEvseNameEdit",
    description: "Lets operators rename an EVSE (charge point) from the portal.",
    type: "feature",
    createdAt: daysAgo(90),
    createdBy: "m.chen",
    owner: "m.chen",
    tags: ["evse"],
    environments: {
      test: env(true, daysAgo(90), "m.chen"),
      qa: env(true, daysAgo(85), "m.chen"),
      prod: env(true, daysAgo(80), "m.chen"),
    },
    services: [binding("svc-evapl-service-frontend", "runtime", hoursAgo(0.2)), binding("svc-evam-service-host", "runtime", hoursAgo(0.1))],
  },
  {
    id: "flag-assetNuvoloIntegrationEnabled",
    key: "assetNuvoloIntegrationEnabled",
    description: "Syncs charger assets with the Nuvolo asset-management system.",
    type: "release",
    createdAt: daysAgo(12),
    createdBy: "r.singh",
    owner: "r.singh",
    tags: ["assets"],
    reviewBy: daysAhead(20),
    environments: {
      test: env(true, daysAgo(10), "r.singh"),
      qa: env(false, daysAgo(12), "r.singh"),
      prod: env(false, daysAgo(12), "r.singh"),
    },
    services: [binding("svc-evam-service-host", "runtime", hoursAgo(0.1)), binding("svc-evnm-service-charger-infrastructure", "runtime", hoursAgo(1.8))],
  },
  {
    id: "flag-availabilityActionsEnabled",
    key: "availabilityActionsEnabled",
    description: "Availability actions (set available / unavailable) on charge points.",
    type: "release",
    createdAt: daysAgo(70),
    createdBy: "a.kowalska",
    owner: "a.kowalska",
    tags: ["availability"],
    reviewBy: daysAgo(3),
    environments: {
      test: env(true, daysAgo(70), "a.kowalska"),
      qa: env(true, daysAgo(68), "a.kowalska"),
      prod: env(true, daysAgo(60), "m.chen"),
    },
    services: [
      binding("svc-evapl-service-frontend", "both", hoursAgo(0.2), false, { test: true, qa: true, prod: false }),
      binding("svc-evam-service-host", "runtime", hoursAgo(90), true),
    ],
  },
  {
    id: "flag-b2cCustomersEnabled",
    key: "b2cCustomersEnabled",
    description: "Enables B2C (private) customer accounts next to business customers.",
    type: "release",
    createdAt: daysAgo(20),
    createdBy: "j.novak",
    owner: "j.novak",
    tags: ["b2c"],
    reviewBy: daysAhead(30),
    dependsOn: "assetNuvoloIntegrationEnabled",
    environments: {
      test: env(true, daysAgo(9), "j.novak"),
      qa: env(false, daysAgo(20), "j.novak"),
      prod: env(false, daysAgo(20), "j.novak"),
    },
    services: [binding("svc-evboweb-service-bff", "runtime", hoursAgo(0.5)), binding("svc-evapl-service-frontend", "runtime", hoursAgo(0.2))],
  },
  {
    id: "flag-changeCpmsAllowed",
    key: "changeCpmsAllowed",
    description: "Allows changing the CPMS a charge point is attached to.",
    type: "feature",
    createdAt: daysAgo(100),
    createdBy: "m.chen",
    owner: "m.chen",
    tags: ["cpms"],
    environments: {
      test: env(true, daysAgo(100), "m.chen"),
      qa: env(true, daysAgo(95), "m.chen"),
      prod: env(true, daysAgo(90), "m.chen"),
    },
    services: [binding("svc-evam-service-host", "runtime", hoursAgo(0.1)), binding("svc-evnm-service-charger-infrastructure", "runtime", hoursAgo(1.8))],
  },
  {
    id: "flag-chargerBaseEditEnabled",
    key: "chargerBaseEditEnabled",
    description: "Editing of base charger data (name, location, connectors) in the portal.",
    type: "release",
    createdAt: daysAgo(25),
    createdBy: "r.singh",
    owner: "r.singh",
    tags: ["charger"],
    reviewBy: daysAhead(14),
    environments: {
      test: env(true, daysAgo(25), "r.singh"),
      qa: env(true, daysAgo(20), "r.singh"),
      prod: env(true, daysAgo(10), "r.singh"),
    },
    services: [binding("svc-evnm-service-charger-infrastructure", "runtime", hoursAgo(1.8)), binding("svc-evapl-service-frontend", "runtime", hoursAgo(0.2))],
  },
];

const rawAuditLog: AuditLogEntry[] = [
  {
    id: "a1",
    timestamp: hoursAgo(0.1),
    actor: "r.singh",
    action: "credential-rotated",
    serviceKey: "evsim-service-sim-adapter",
    note: "Rotation window closes in 24h — old credential still valid.",
  },
  { id: "a2", timestamp: hoursAgo(9), actor: "j.novak", action: "env-enabled", flagKey: "b2cCustomersEnabled", environment: "test", from: "off", to: "on" },
  {
    id: "a3",
    timestamp: hoursAgo(30),
    actor: "r.singh",
    action: "promotion-blocked",
    flagKey: "assetNuvoloIntegrationEnabled",
    environment: "prod",
    note: "Blocked — qa was not yet enabled at attempt time.",
  },
  { id: "a4", timestamp: daysAgo(10), actor: "r.singh", action: "env-enabled", flagKey: "chargerBaseEditEnabled", environment: "prod", from: "off", to: "on" },
  {
    id: "a5",
    timestamp: daysAgo(10),
    actor: "r.singh",
    action: "env-enabled",
    flagKey: "assetNuvoloIntegrationEnabled",
    environment: "test",
    from: "off",
    to: "on",
  },
  { id: "a6", timestamp: daysAgo(12), actor: "m.chen", action: "credential-rotated", serviceKey: "evboweb-service-bff" },
  { id: "a7", timestamp: daysAgo(12), actor: "r.singh", action: "flag-created", flagKey: "assetNuvoloIntegrationEnabled" },
  { id: "a8", timestamp: daysAgo(20), actor: "j.novak", action: "flag-created", flagKey: "b2cCustomersEnabled" },
  { id: "a9", timestamp: daysAgo(25), actor: "r.singh", action: "flag-created", flagKey: "chargerBaseEditEnabled" },
  {
    id: "a10",
    timestamp: daysAgo(60),
    actor: "m.chen",
    action: "env-enabled",
    flagKey: "availabilityActionsEnabled",
    environment: "prod",
    from: "off",
    to: "on",
  },
  { id: "a11", timestamp: daysAgo(64), actor: "r.singh", action: "service-registered", serviceKey: "evsim-service-sim-adapter" },
  { id: "a12", timestamp: daysAgo(80), actor: "m.chen", action: "env-enabled", flagKey: "allowEvseNameEdit", environment: "prod", from: "off", to: "on" },
  { id: "a13", timestamp: daysAgo(80), actor: "j.novak", action: "service-registered", serviceKey: "evnm-service-charger-infrastructure" },
  { id: "a14", timestamp: daysAgo(90), actor: "m.chen", action: "env-enabled", flagKey: "changeCpmsAllowed", environment: "prod", from: "off", to: "on" },
  { id: "a15", timestamp: daysAgo(96), actor: "m.chen", action: "service-registered", serviceKey: "evboweb-service-bff" },
  { id: "a16", timestamp: daysAgo(120), actor: "a.kowalska", action: "service-registered", serviceKey: "evapl-service-frontend" },
  { id: "a17", timestamp: daysAgo(120), actor: "a.kowalska", action: "service-registered", serviceKey: "evam-service-host" },
];

export const auditLog: AuditLogEntry[] = [...rawAuditLog].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
