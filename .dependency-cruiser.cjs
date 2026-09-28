/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-purity',
      severity: 'error',
      comment:
        'packages/domain must stay pure: no framework, database, AI, HTTP, or node builtins (CONTRACT-v0.2, ADR-0009).',
      from: { path: '^packages/domain' },
      to: {
        path: '^(packages/(?!domain)|apps/)|^(node:|pg$|postgres|fastify|react|next|zod|ai$|@ai-sdk)',
      },
    },
    {
      name: 'web-cannot-use-database',
      severity: 'error',
      comment: 'apps/web must not access PostgreSQL or packages/database (CONTRACT-v0.2).',
      from: { path: '^apps/web' },
      to: { path: '^packages/database' },
    },
    {
      name: 'ui-no-database',
      severity: 'error',
      comment: 'packages/ui must not access the database.',
      from: { path: '^packages/ui' },
      to: { path: '^packages/database' },
    },
    {
      name: 'ui-no-permissions-engine',
      severity: 'error',
      comment:
        'packages/ui must not import the authorization engine (presentation only) (CONTRACT-v0.2).',
      from: { path: '^packages/ui' },
      to: { path: '^packages/permissions' },
    },
    {
      name: 'permissions-no-database-implementation',
      severity: 'error',
      comment: 'packages/permissions must not depend on database implementation (ADR-0007).',
      from: { path: '^packages/permissions' },
      to: { path: '^packages/database' },
    },
    {
      name: 'permissions-no-web',
      severity: 'error',
      comment: 'packages/permissions must not depend on web or API framework apps.',
      from: { path: '^packages/permissions' },
      to: { path: '^apps/' },
    },
    {
      name: 'auth-not-authorization-engine',
      severity: 'error',
      comment: 'packages/auth must not import permissions (auth ≠ authz) (ADR-0007).',
      from: { path: '^packages/auth' },
      to: { path: '^packages/permissions' },
    },
    {
      name: 'database-no-auth',
      severity: 'error',
      comment: 'packages/database must not import auth.',
      from: { path: '^packages/database' },
      to: { path: '^packages/auth' },
    },
    {
      name: 'database-no-permissions',
      severity: 'error',
      comment: 'packages/database must not import permissions (policy stays above persistence).',
      from: { path: '^packages/database' },
      to: { path: '^packages/permissions' },
    },
    {
      name: 'validation-only-domain',
      severity: 'error',
      comment: 'packages/validation may depend on domain only among workspace packages.',
      from: { path: '^packages/validation' },
      to: { path: '^packages/(?!(domain|validation))' },
    },
    {
      name: 'api-cannot-import-web-or-worker',
      severity: 'error',
      comment: 'Apps must not import each other; share via packages only.',
      from: { path: '^apps/api/' },
      to: { path: '^apps/(web|worker)/' },
    },
    {
      name: 'web-cannot-import-api-or-worker',
      severity: 'error',
      comment: 'Apps must not import each other; share via packages only.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/(api|worker)/' },
    },
    {
      name: 'worker-cannot-import-api-or-web',
      severity: 'error',
      comment: 'Apps must not import each other; share via packages only.',
      from: { path: '^apps/worker/' },
      to: { path: '^apps/(api|web)/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.eslint.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    exclude: { path: '(node_modules|dist|\\.turbo|coverage)' },
    parser: 'tsc',
    skipAnalysisNotInRules: false,
  },
};
