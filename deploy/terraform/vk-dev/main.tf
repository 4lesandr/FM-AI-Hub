locals {
  flavor_name = var.flavor_override != "" ? var.flavor_override : (
    var.role == "ci" ? var.flavor_ci : var.flavor_dev
  )
  user_data = file("${path.module}/${var.user_data_path}")
}

data "vkcs_compute_flavor" "this" {
  name = local.flavor_name
}

data "vkcs_images_image" "ubuntu" {
  name = var.image_name
}

data "vkcs_networking_network" "internet" {
  name = var.network_name
}

data "vkcs_networking_secgroup" "selected" {
  for_each = toset(var.security_group_names)
  name     = each.value
}

# Sticky boot disk. stop ≠ destroy. S3 layer restore not implemented — wipe = cold ~50m.
resource "vkcs_blockstorage_volume" "boot" {
  name              = var.volume_name
  size              = var.volume_size_gb
  volume_type       = var.volume_type
  image_id          = data.vkcs_images_image.ubuntu.id
  availability_zone = var.az

  lifecycle {
    prevent_destroy = true
    # After first create / import, image metadata churn must not force replacement.
    ignore_changes = [image_id, metadata, name]
  }
}

resource "vkcs_compute_instance" "this" {
  count = var.manage_compute ? 1 : 0

  name               = var.name
  flavor_id          = data.vkcs_compute_flavor.this.id
  key_pair           = var.key_name
  security_group_ids = [for sg in data.vkcs_networking_secgroup.selected : sg.id]
  availability_zone  = var.az
  user_data          = local.user_data
  config_drive       = true

  block_device {
    uuid                  = vkcs_blockstorage_volume.boot.id
    source_type           = "volume"
    destination_type      = "volume"
    boot_index            = 0
    delete_on_termination = false
  }

  network {
    uuid = data.vkcs_networking_network.internet.id
  }

  lifecycle {
    # stop/start is out-of-band (fmah-builder-up/down).
    # Imported sticky hosts drift on block_device/source_type/config_drive vs create-time
    # schema — NEVER let plan recreate an in-flight builder (destroys boot attach).
    # Intentional recreate: taint + apply only after seal artifact + explicit down.
    ignore_changes = [
      flavor_id,
      user_data,
      config_drive,
      block_device,
      network,
      security_group_ids,
      metadata,
      tags,
      image_id,
    ]
  }

  depends_on = [vkcs_blockstorage_volume.boot]
}
