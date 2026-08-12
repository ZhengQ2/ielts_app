#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_region="${AWS_REGION:-us-east-1}"
stack_name="${STACK_NAME:-ielts-map-static}"
policy_file="${project_root}/packages/core/data/after-test-policy.json"

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

echo "Uploading the after-test policy feed..."
aws s3 cp \
  "$policy_file" \
  "s3://${bucket_name}/data/after-test-policy.json" \
  --content-type "application/json" \
  --cache-control "public,max-age=300" \
  --only-show-errors

echo "Refreshing the policy feed in CloudFront..."
aws cloudfront create-invalidation \
  --distribution-id "$distribution_id" \
  --paths "/data/after-test-policy.json" \
  --query "Invalidation.Id" \
  --output text
