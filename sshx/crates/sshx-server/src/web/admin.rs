use std::sync::Arc;

use axum::{
    extract::{State, Json},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::ServerState;

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Serialize)]
struct Device {
    id: String,
    elapsed_secs: u64,
    key: Option<String>,
    hostname: String,
    user: String,
    cpu: String,
    memory_mb: u64,
    os_info: String,
}

#[derive(Serialize)]
struct ServerStats {
    cpu_usage: f32,
    total_memory: u64,
    used_memory: u64,
    total_disk: u64,
    used_disk: u64,
    uptime: u64,
}

#[derive(Serialize)]
struct DashboardData {
    devices: Vec<Device>,
    stats: ServerStats,
}

pub fn routes() -> Router<Arc<ServerState>> {
    Router::new()
        .route("/login", post(login))
        .route("/devices", get(list_devices))
}

async fn login(Json(payload): Json<LoginRequest>) -> Response {
    if payload.password == "1234" {
        (StatusCode::OK, Json("Login successful")).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, "Invalid password").into_response()
    }
}

async fn list_devices(State(state): State<Arc<ServerState>>) -> Json<DashboardData> {
    // Get devices
    let raw_sessions = state.list_sessions();
    let devices = raw_sessions
        .into_iter()
        .map(|(id, elapsed_secs, key, hostname, user, cpu, memory_mb, os_info)| Device {
            id,
            elapsed_secs,
            key,
            hostname,
            user,
            cpu,
            memory_mb,
            os_info,
        })
        .collect();

    // Get server stats
    let stats = {
        use sysinfo::{Disks, System};
        
        let mut sys = state.system.lock();
        sys.refresh_all(); 

        let cpu_usage = sys.global_cpu_info().cpu_usage();
        let total_memory = sys.total_memory();
        let used_memory = sys.used_memory();
        let uptime = System::uptime();

        let disks = Disks::new_with_refreshed_list();
        let mut total_disk = 0;
        let mut used_disk = 0;
        for disk in &disks {
            total_disk += disk.total_space();
            used_disk += disk.total_space() - disk.available_space();
        }

        ServerStats {
            cpu_usage,
            total_memory,
            used_memory,
            total_disk,
            used_disk,
            uptime,
        }
    };

    Json(DashboardData { devices, stats })
}
