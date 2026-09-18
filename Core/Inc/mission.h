/*
 * mission.h
 *
 *  Created on: Aug 24, 2026
 *      Author: lethanhtra
 */

#ifndef MISSION_H
#define MISSION_H

#include <stdint.h>
#include <stdbool.h>
#include "main.h"
// (Các khai báo struct cũ của bạn giữ nguyên)

#define MAX_WAYPOINTS 100       // Số lượng Waypoint tối đa
#define MISSION_BUFFER_SIZE 1024 // Kích thước mảng đệm DMA

// Cấu trúc lưu trữ tọa độ 1 Waypoint
// Lưu ý: Dùng double để không mất độ chính xác của GPS
typedef struct {
    double lat;
    double lon;
} Waypoint_t;

// Cấu trúc quản lý toàn bộ Mission
typedef struct {
    Waypoint_t waypoints[MAX_WAYPOINTS];
    uint16_t count;
    bool is_receiving;         // Cờ báo hiệu đang trong quá trình nhận dữ liệu
    bool is_ready;             // Cờ báo hiệu đã nhận xong toàn bộ mission và sẵn sàng bay
} MissionData_t;

// Các hàm giao tiếp
void Mission_Init_DMA(UART_HandleTypeDef *huart);
float calculate_distance(double lat1, double lon1, double lat2, double lon2);

void Mission_ParseChunk(uint8_t *data, uint16_t len);

uint16_t Mission_GetCount(void);
Waypoint_t Mission_GetWaypoint(uint16_t index);
bool Mission_IsReady(void);

#endif /* MISSION_H */
