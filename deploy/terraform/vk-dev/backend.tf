# Remote state: VK Hotbox (S3-compatible).
# Secrets live in ~/.config/vkcloud/fmah-tfstate.env — never commit keys.
#
#   set -a && source ~/.config/vkcloud/fmah-tfstate.env && set +a
#   terraform init -backend-config=backend.hcl
#
# Existing FMAH stack uses key `fmah/terraform.tfstate` — do NOT reuse it.
# This module uses `fm-ai-hub/vk-dev/terraform.tfstate` (see backend.hcl.example).

terraform {
  backend "s3" {}
}
