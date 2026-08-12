#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_region="${AWS_REGION:-us-east-1}"
stack_name="${STACK_NAME:-ielts-map-static}"
domain_name="${DOMAIN_NAME:-ielts.zhengqiu.net}"
zone_name="${ZONE_NAME:-zhengqiu.net}"

if [[ "$deploy_region" != "us-east-1" ]]; then
  echo "AWS_REGION must be us-east-1 because CloudFront certificates are issued there." >&2
  exit 1
fi

cd "$project_root"

echo "Building the static export..."
npm run build

hosted_zone_id="${HOSTED_ZONE_ID:-}"
if [[ -z "$hosted_zone_id" ]]; then
  hosted_zone_id="$(
    aws route53 list-hosted-zones-by-name \
      --dns-name "${zone_name}." \
      --max-items 1 \
      --query "HostedZones[?Name=='${zone_name}.']|[0].Id" \
      --output text
  )"
fi
hosted_zone_id="${hosted_zone_id#/hostedzone/}"

if [[ -z "$hosted_zone_id" || "$hosted_zone_id" == "None" ]]; then
  echo "No Route 53 hosted zone found for ${zone_name}." >&2
  exit 1
fi

echo "Deploying the private S3 bucket, HTTPS certificate, CloudFront, and DNS..."
aws cloudformation deploy \
  --region "$deploy_region" \
  --stack-name "$stack_name" \
  --template-file infra/aws-static-site.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "DomainName=${domain_name}" \
    "HostedZoneId=${hosted_zone_id}" \
  --no-fail-on-empty-changeset

bucket_name="$(
  aws cloudformation describe-stacks \
    --region "$deploy_region" \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
    --output text
)"
distribution_id="$(
  aws cloudformation describe-stacks \
    --region "$deploy_region" \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
    --output text
)"
admin_user_pool_id="$(
  aws cloudformation describe-stacks \
    --region "$deploy_region" \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='AdminUserPoolId'].OutputValue" \
    --output text
)"

echo "Uploading immutable build assets..."
aws s3 sync \
  apps/web/out/_next/static \
  "s3://${bucket_name}/_next/static" \
  --delete \
  --only-show-errors \
  --cache-control "public,max-age=31536000,immutable"

echo "Uploading pages and the centre feed..."
aws s3 sync \
  apps/web/out \
  "s3://${bucket_name}" \
  --delete \
  --exclude "_next/static/*" \
  --only-show-errors \
  --cache-control "public,max-age=300"

echo "Refreshing CloudFront..."
aws cloudfront create-invalidation \
  --distribution-id "$distribution_id" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text

echo "Deployed: https://${domain_name}"
if [[ -n "$admin_user_pool_id" && "$admin_user_pool_id" != "None" ]]; then
  echo "Internal editor: https://${domain_name}/internal/"
  echo "Admin user pool: ${admin_user_pool_id}"
fi
