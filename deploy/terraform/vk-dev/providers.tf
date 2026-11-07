# Auth: source ~/.config/vkcloud/fmah-openrc.sh (OS_*).
# Same project as fmah-builder.env: OS_PROJECT_ID / msk.cloud.vk.ru.

provider "vkcs" {
  auth_url   = var.auth_url
  project_id = var.project_id
  region     = var.region
  # username/password from env: OS_USERNAME / OS_PASSWORD
}
