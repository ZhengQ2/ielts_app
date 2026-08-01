#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_region="${AWS_REGION:-us-east-1}"
stack_name="${STACK_NAME:-ielts-map-static}"
admin_email="${ADMIN_EMAIL:-}"

if [[ -z "$admin_email" ]]; then
  echo "ADMIN_EMAIL is required." >&2
  echo "Example: ADMIN_EMAIL=owner@example.com npm run admin:create-user" >&2
  exit 1
fi

cd "$project_root"

user_pool_id="$(
  aws cloudformation describe-stacks \
    --region "$deploy_region" \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='AdminUserPoolId'].OutputValue" \
    --output text
)"

if [[ -z "$user_pool_id" || "$user_pool_id" == "None" ]]; then
  echo "The stack has no admin user pool. Deploy the current infrastructure first." >&2
  exit 1
fi

if aws cognito-idp admin-get-user \
  --region "$deploy_region" \
  --user-pool-id "$user_pool_id" \
  --username "$admin_email" >/dev/null 2>&1; then
  echo "Admin user already exists: ${admin_email}"
else
  aws cognito-idp admin-create-user \
    --region "$deploy_region" \
    --user-pool-id "$user_pool_id" \
    --username "$admin_email" \
    --user-attributes \
      "Name=email,Value=${admin_email}" \
      "Name=email_verified,Value=true" \
    --desired-delivery-mediums EMAIL \
    --query 'User.Username' \
    --output text
  echo "Cognito sent a temporary password to ${admin_email}."
fi

aws cognito-idp admin-add-user-to-group \
  --region "$deploy_region" \
  --user-pool-id "$user_pool_id" \
  --username "$admin_email" \
  --group-name admins

echo "Administrator access granted: ${admin_email}"
