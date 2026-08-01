# Internal centre editor

The production editor is available at `https://ielts.zhengqiu.net/internal/`.

## Security model

- The HTML login shell is static and contains no centre-management credentials.
- Authentication uses an Amazon Cognito authorization-code flow with PKCE.
- Self-registration is disabled. AWS administrators create users explicitly.
- API Gateway validates the Cognito JWT, and the Lambda handler independently requires membership
  in the `admins` group before reading or writing overrides.
- The browser keeps the one-hour tokens in `sessionStorage`, not persistent local storage.
- DynamoDB uses on-demand billing and point-in-time recovery. The table and user pool are retained
  if the CloudFormation stack is removed.

## Editing behavior

The editor loads every centre from the deployed source feed. Selecting a centre opens its complete
JSON record. On save, the browser compares the edited record with the source-backed record and
stores only changed top-level fields as a durable override.

The public `/data/centres.json` endpoint merges these overrides at request time and is cached by
CloudFront for at most 60 seconds. List and map views therefore receive edits without rebuilding
the static site. Centre detail pages hydrate from that same feed while retaining their source-backed
static HTML as an offline/error fallback. The separate mobile export files remain build-time data.

Removing an override restores the source-backed record. Setting `isPublishable` to `false` removes
an ordinary centre from the merged public feed. A record marked `futureOpening` remains visible so
its interest form can be shown.

## Create an administrator

After deploying the infrastructure:

```bash
ADMIN_EMAIL=owner@example.com npm run admin:create-user
```

Cognito emails a temporary password. At first login, the administrator must replace it with a
password satisfying the user-pool policy. Never commit passwords or tokens to the repository.
