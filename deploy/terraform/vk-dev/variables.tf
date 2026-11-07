variable "auth_url" {
  type        = string
  description = "Keystone URL"
  default     = "https://msk.cloud.vk.ru/infra/identity/v3/"
}

variable "project_id" {
  type        = string
  description = "VK Cloud project id (dev-fm-agenthub)"
  default     = "f7cb05e008d74869bd9030c99e49df43"
}

variable "region" {
  type    = string
  default = "RegionOne"
}

variable "role" {
  type        = string
  description = "Profile: dev (warm STD3-4-16) or ci (build STD3-16-32). Does not auto-wake."
  default     = "dev"

  validation {
    condition     = contains(["dev", "ci"], var.role)
    error_message = "role must be dev or ci"
  }
}

variable "flavor_dev" {
  type        = string
  description = "Warm manual-up flavor (locked 2026-11-07)"
  default     = "STD3-4-16"
}

variable "flavor_ci" {
  type        = string
  description = "Primary CI build flavor"
  default     = "STD3-16-32"
}

variable "flavor_ci_fallback" {
  type        = string
  description = "OOM fallback for CI (documented; not auto)"
  default     = "STD3-32-64"
}

variable "flavor_override" {
  type        = string
  description = "If set, forces this flavor (e.g. import of live STD3-32-64). Empty = role map."
  default     = ""
}

variable "name" {
  type    = string
  default = "dev-fm-agenthub"
}

variable "volume_name" {
  type        = string
  description = "Boot volume name (sticky). Keep across stop/start."
  default     = "dev-fm-agenthub-boot"
}

variable "volume_size_gb" {
  type    = number
  default = 100
}

variable "volume_type" {
  type    = string
  default = "ceph-ssd"
}

variable "image_name" {
  type    = string
  default = "ubuntu-24-202607090925.gitd6f5e545"
}

variable "az" {
  type    = string
  default = "PA2"
}

variable "key_name" {
  type    = string
  default = "fmah-dev"
}

variable "network_name" {
  type        = string
  description = "Public internet network (VK: address is on NIC, not classic FIP)"
  default     = "internet"
}

variable "security_group_names" {
  type    = list(string)
  default = ["fmah-hub", "default"]
}

variable "user_data_path" {
  type        = string
  description = "Cloud-init file (repo copy; keep in sync with ~/.config/vkcloud/dev-fm-agenthub-cloud-init.yaml)"
  default     = "cloud-init.yaml"
}

variable "manage_compute" {
  type        = bool
  description = "If false, only volume is managed (advanced). Default true."
  default     = true
}
