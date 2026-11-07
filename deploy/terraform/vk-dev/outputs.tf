output "role" {
  value       = var.role
  description = "Active profile flag (dev|ci). Flavor may differ if ignore_changes / override."
}

output "flavor" {
  value       = local.flavor_name
  description = "Desired flavor for role (live instance may differ until recreate)"
}

output "flavor_ci_fallback" {
  value       = var.flavor_ci_fallback
  description = "Documented OOM fallback for CI jobs"
}

output "server_id" {
  value       = try(vkcs_compute_instance.this[0].id, null)
  description = "Compute instance UUID"
}

output "volume_id" {
  value       = vkcs_blockstorage_volume.boot.id
  description = "Sticky boot volume UUID (delete_on_termination=false)"
}

output "ip" {
  value       = try(vkcs_compute_instance.this[0].access_ip_v4, null)
  description = "Public IPv4 on internet network"
}

output "name" {
  value = var.name
}

output "az" {
  value = var.az
}

output "builder_state_snippet" {
  description = "Lines suitable for ~/.config/vkcloud/fmah-builder.state"
  value       = <<-EOT
    SERVER_ID=${try(vkcs_compute_instance.this[0].id, "")}
    VOLUME_ID=${vkcs_blockstorage_volume.boot.id}
    IP=${try(vkcs_compute_instance.this[0].access_ip_v4, "")}
  EOT
}
