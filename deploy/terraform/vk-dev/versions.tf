terraform {
  required_version = ">= 1.5.0"

  required_providers {
    vkcs = {
      # Note: source is vk-cs/vkcs (not vk-cloud). registry.terraform.io may be
      # geo-blocked from RU — use local mirror (see README) or GitHub release.
      source  = "vk-cs/vkcs"
      version = "~> 0.19.0"
    }
  }
}
