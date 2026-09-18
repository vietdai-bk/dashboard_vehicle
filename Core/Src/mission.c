/*
 * mission.c
 *
 *  Created on: Aug 24, 2026
 *      Author: lethanhtra
 */

#include "mission.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include "cJSON.h" // Thêm file cJSON.h và cJSON.c vào project STM32 của bạn

MissionData_t current_mission;

// Bộ đệm phụ để ghép nối các ký tự thành 1 dòng hoàn chỉnh
#define MAX_LINE_LEN 1024
static char line_buf[MAX_LINE_LEN];
static uint16_t line_idx = 0;
uint8_t rx_mission_dma_buffer[MISSION_BUFFER_SIZE];
static UART_HandleTypeDef *mission_huart;

extern uint8_t robot_armed;
extern uint8_t robot_start;

void Mission_Init_DMA(UART_HandleTypeDef *huart) {
	current_mission.count = 0;
	current_mission.is_receiving = false;
	current_mission.is_ready = false;
	line_idx = 0;
	memset(line_buf, 0, MAX_LINE_LEN);

	mission_huart = huart;
	memset(rx_mission_dma_buffer, 0, MISSION_BUFFER_SIZE);
	// Bật DMA nhận dữ liệu kết hợp ngắt IDLE Line cho UART2
	HAL_UARTEx_ReceiveToIdle_DMA(mission_huart, rx_mission_dma_buffer,
	MISSION_BUFFER_SIZE);
}

static void Mission_ProcessLine(char *line) {
	cJSON *json = cJSON_Parse(line);
	if (json == NULL)
		return;

	cJSON *cmd = cJSON_GetObjectItemCaseSensitive(json, "command");

	if (cJSON_IsString(cmd) && (cmd->valuestring != NULL)) {

		// 1. LỆNH UPLOAD MISSION
		if (strcmp(cmd->valuestring, "UPLOAD_MISSION") == 0) {
			cJSON *waypoints = cJSON_GetObjectItemCaseSensitive(json,
					"waypoints");
			if (cJSON_IsArray(waypoints)) {
				current_mission.count = 0;
				int wp_count = cJSON_GetArraySize(waypoints);
				for (int i = 0;
						i < wp_count && current_mission.count < MAX_WAYPOINTS;
						i++) {
					cJSON *wp = cJSON_GetArrayItem(waypoints, i);
					cJSON *lat = cJSON_GetObjectItemCaseSensitive(wp, "lat");
					cJSON *lon = cJSON_GetObjectItemCaseSensitive(wp, "lon");

					if (cJSON_IsNumber(lat) && cJSON_IsNumber(lon)) {
						current_mission.waypoints[current_mission.count].lat =
								lat->valuedouble;
						current_mission.waypoints[current_mission.count].lon =
								lon->valuedouble;
						current_mission.count++;
					}
				}
				if (current_mission.count > 0) {
					current_mission.is_ready = true;
				}
			}
		}
		// 2. LỆNH ARM (Mở khóa)
		else if (strcmp(cmd->valuestring, "ARM") == 0) {
			robot_armed = 1;
		}
		// 3. LỆNH DISARM (Khóa động cơ)
		else if (strcmp(cmd->valuestring, "DISARM") == 0) {
			robot_armed = 0;
			robot_start = 0; // Hủy luôn trạng thái chạy nếu bị khóa
		}
		// 4. LỆNH START (Bắt đầu chạy)
		else if (strcmp(cmd->valuestring, "START") == 0) {
			if (robot_armed && current_mission.is_ready) {
				robot_start = 1;
			}
		}
		// 5. LỆNH STOP (Dừng khẩn cấp)
		else if (strcmp(cmd->valuestring, "STOP") == 0) {
			robot_start = 0;
		}

		// 6. GỬI ACK CHUNG CHO TẤT CẢ CÁC LỆNH
		char ack_buf[128];
		snprintf(ack_buf, sizeof(ack_buf),
				"{\"type\":\"ack\",\"command\":\"%s\",\"ok\":true}\n",
				cmd->valuestring);
//		HAL_UART_Transmit_DMA(mission_huart, (uint8_t*) ack_buf, strlen(ack_buf));

		if (mission_huart->gState != HAL_UART_STATE_READY) {
			HAL_UART_AbortTransmit(mission_huart);
		}

		// Bắt buộc dùng chế độ chặn (blocking) với timeout nhỏ (15ms).
		// Điều này đảm bảo khi gửi nhiều lệnh liên tiếp, lệnh 1 gửi xong hoàn toàn mới vòng sang xử lý và gửi ACK lệnh 2.
		HAL_UART_Transmit(mission_huart, (uint8_t*) ack_buf, strlen(ack_buf),
				15);
	}

	cJSON_Delete(json);
}

// Hàm đẩy luồng dữ liệu thô từ DMA vào, tự động tách dòng
void Mission_ParseChunk(uint8_t *data, uint16_t len) {
	for (uint16_t i = 0; i < len; i++) {
		char c = (char) data[i];

		if (c == '\n') {
			line_buf[line_idx] = '\0'; // Kết thúc chuỗi C standard
			Mission_ProcessLine(line_buf);
			line_idx = 0; // Reset bộ đệm dòng để đọc dòng tiếp theo
		} else if (c != '\r' && line_idx < (MAX_LINE_LEN - 1)) {
			line_buf[line_idx++] = c;
		}
	}
}

// Các hàm Getter cho các module khác gọi (Flight Controller, Navigation...)
uint16_t Mission_GetCount(void) {
	return current_mission.count;
}

Waypoint_t Mission_GetWaypoint(uint16_t index) {
	Waypoint_t empty = { 0.0, 0.0 };
	if (index < current_mission.count) {
		return current_mission.waypoints[index];
	}
	return empty; // Trả về 0 nếu gọi sai index
}

bool Mission_IsReady(void) {
	return current_mission.is_ready;
}
