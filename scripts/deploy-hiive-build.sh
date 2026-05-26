#!/usr/bin/env bash

set -euo pipefail

export AWS_PAGER=""

site_domain="${HIIVE_BUILD_SITE_DOMAIN:-provider.ehr.hiivehealth.net}"
bucket="${HIIVE_BUILD_BUCKET:-$site_domain}"
dist_dir="${DIST_DIR:-dist}"

if [[ ! -d "$dist_dir" ]]; then
  echo "Build output directory not found: $dist_dir" >&2
  exit 1
fi

distribution_id="$({
  aws cloudfront list-distributions \
    --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '${site_domain}')].Id | [0]" \
    --output text
} | tr -d '\r')"

if [[ -z "$distribution_id" || "$distribution_id" == "None" ]]; then
  echo "CloudFront distribution not found for alias: $site_domain" >&2
  exit 1
fi

echo "Syncing ${dist_dir}/ to s3://${bucket}/"
aws s3 sync "${dist_dir}/" "s3://${bucket}/" --delete

echo "Creating CloudFront invalidation for ${distribution_id}"
aws cloudfront create-invalidation --distribution-id "$distribution_id" --paths '/*' >/dev/null

echo "Deployment complete for ${site_domain}"