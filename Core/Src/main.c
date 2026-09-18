/* USER CODE BEGIN Header */
/**
 ******************************************************************************
 * @file           : main.c
 * @brief          : Main program body
 ******************************************************************************
 * @attention
 *
 * Copyright (c) 2026 STMicroelectronics.
 * All rights reserved.
 *
 * This software is licensed under terms that can be found in the LICENSE file
 * in the root directory of this software component.
 * If no LICENSE file comes with this software, it is provided AS-IS.
 *
 ******************************************************************************
 */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "ina219.h"
#include "icm20602.h"
#include "ist8310.h"
#include "kalman.h"
#include "pid_controller.h"
#include "gps.h"
#include "mission.h"
#include "navigation.h"
#include "kalman_gps.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
I2C_HandleTypeDef hi2c1;

SPI_HandleTypeDef hspi1;

TIM_HandleTypeDef htim3;

UART_HandleTypeDef huart1;
UART_HandleTypeDef huart2;
UART_HandleTypeDef huart3;
DMA_HandleTypeDef hdma_usart1_rx;
DMA_HandleTypeDef hdma_usart2_rx;
DMA_HandleTypeDef hdma_usart3_rx;
DMA_HandleTypeDef hdma_usart3_tx;

/* USER CODE BEGIN PV */

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_I2C1_Init(void);
static void MX_SPI1_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_USART2_UART_Init(void);
static void MX_USART3_UART_Init(void);
static void MX_TIM3_Init(void);
/* USER CODE BEGIN PFP */

/*======== STRUCT VARIABLE=========*/
ICM20602_t imu;
IST8310_Data_t ist8310;
GPS_Data_t gps;

KalmanFilter1D_t kf_North; // X Axis
KalmanFilter1D_t kf_East;  // Y Axis

// =======PID Controller======
PIDController_t PID_Rate_Yaw;
PIDController_t PID_Pos_X;
PIDController_t PID_Pos_Y;
PIDController_t PID_Vel_X;
PIDController_t PID_Vel_Y;

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */
//extern MissionData_t current_mission;
float battery = 0.0f;

uint8_t ist_status;
uint8_t trans_flag = 0;

/* ========ANGLE AND ACCEL + GYRO PARAM=======*/
float yaw = 0.0f;
float pitch = 0.0f, roll = 0.0f;
float ax, ay, az;
float gx, gy, gz;
float ax_offset = 0, ay_offset = 0, az_offset = 1;
float gx_offset = 0, gy_offset = 0, gz_offset = 0;

float target_yaw = 34;
/* =======PID CONTROLLER PARAM =========*/
float kp_y = 20, ki_y = 0, kd_y = 5;
int base_speed = 700;
float left_speed = 0, right_speed = 0;

/*==========GPS ESTIMATE POSITION==========*/
#define FLOW_ALPHA     0.2f
#define KP_FLOW        0.25f
#define KI_FLOW        0.02f
#define KP_POS         0.10f

float ax_earth = 0.0f;
float ay_earth = 0.0f;

float ax_bias = 0.0f;
float ay_bias = 0.0f;

// Vận tốc ước lượng (Earth Frame)
float est_vx = 0.0f;
float est_vy = 0.0f;

// Vị trí ước lượng (Earth Frame) - m
float est_x = 0.0f;
float est_y = 0.0f;

// Điểm neo (Target)
#define MAX_TARGET_VEL_XY 1.0f  // m/s, tùy kích thước/độ nhạy drone của bạn
float target_x = 0.0f;
float target_y = 0.0f;

float target_vx = 0.0f;
float target_vy = 0.0f;

/*======== MISSION =============== */
extern uint8_t rx_mission_dma_buffer[MISSION_BUFFER_SIZE];
extern uint8_t rx_gps_dma_buffer[GPS_DMA_BUF_SIZE];

void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size) {
	GPS_UART_RxEventCallback(huart, Size);

	if (huart->Instance == USART3) {
		// 1. Chỉ parse đúng số byte DMA vừa nhận
		Mission_ParseChunk(rx_mission_dma_buffer, Size);

		// 2. Dừng DMA hiện tại
		HAL_UART_DMAStop(huart);

		// 3. Xóa toàn bộ buffer
		memset(rx_mission_dma_buffer, 0, MISSION_BUFFER_SIZE);

		// 4. Khởi động lại DMA từ đầu buffer
		HAL_StatusTypeDef status = HAL_UARTEx_ReceiveToIdle_DMA(huart,
				rx_mission_dma_buffer,
				MISSION_BUFFER_SIZE);

		if (status != HAL_OK) {
//			printf("DMA restart ERROR = %d\r\n", status);
		}
	}
}

void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart) {
	// Kiểm tra xem lỗi có xuất phát từ UART của GPS không
	if (huart->Instance == USART1) {
		// Hủy quá trình nhận hiện tại để dọn dẹp cờ lỗi
		HAL_UART_AbortReceive(huart);

		// Quan trọng: Mồi lại DMA để tiếp tục bắt tín hiệu
		HAL_UARTEx_ReceiveToIdle_DMA(&huart1, rx_gps_dma_buffer,
		GPS_DMA_BUF_SIZE);
	}
	if (huart->Instance == USART3) {
		HAL_UART_AbortReceive(huart);
		// Khởi động lại quá trình nhận DMA nếu xảy ra lỗi
		HAL_UARTEx_ReceiveToIdle_DMA(&huart3, rx_mission_dma_buffer,
		MISSION_BUFFER_SIZE);
	}
}

void set_speed(int left_speed, int right_speed) {
	if (left_speed > 0) {
		__HAL_TIM_SET_COMPARE(&htim3, LPWM_1, abs(left_speed));
		__HAL_TIM_SET_COMPARE(&htim3, RPWM_1, abs(0));
	} else {
		__HAL_TIM_SET_COMPARE(&htim3, LPWM_1, abs(0));
		__HAL_TIM_SET_COMPARE(&htim3, RPWM_1, abs(left_speed));
	}
	if (right_speed > 0) {
		__HAL_TIM_SET_COMPARE(&htim3, LPWM_2, abs(right_speed));
		__HAL_TIM_SET_COMPARE(&htim3, RPWM_2, abs(0));
	} else {
		__HAL_TIM_SET_COMPARE(&htim3, LPWM_2, abs(0));
		__HAL_TIM_SET_COMPARE(&htim3, RPWM_2, abs(right_speed));
	}
}

static float computeHeading(float bx, float by, float bz, float roll_deg,
		float pitch_deg) {
	float roll_rad = roll_deg * DEG_TO_RAD;
	float pitch_rad = pitch_deg * DEG_TO_RAD;
	float cr = cosf(roll_rad), sr = sinf(roll_rad);
	float cp = cosf(pitch_rad), sp = sinf(pitch_rad);

	float mx = bx * cp + by * sr * sp + bz * cr * sp;
	float my = by * cr - bz * sr;

	float heading = atan2f(my, mx) * RAD_TO_DEG; /* atan2f trả về sẵn trong [-180,180] */
	if (heading > 180.0f)
		heading -= 360.0f;
	if (heading < -180.0f)
		heading += 360.0f;
	return heading;
}

float readHeading(float roll_deg, float pitch_deg) {
	static float last_heading = 0.0f;
	if (IST8310_Read(&hi2c1, &ist8310) == IST8310_OK) {
//		last_heading = computeHeading(ist8310.raw_y, -ist8310.raw_x,
//				-ist8310.raw_z, roll_deg, pitch_deg);
		last_heading = computeHeading(ist8310.mag_y, -ist8310.mag_x,
				-ist8310.mag_z, roll_deg, pitch_deg);
	}
	return last_heading;

}

float angle_diff(float target, float current) {
	float diff = target - current;		//-170 - 185

	if (diff > 180.0f)
		diff -= 360.0f;

	if (diff < -180.0f)
		diff += 360.0f;

	return diff;
}

void readIMU() {
	ICM20602_Read(&imu);
	gx = (imu.gyro.x - gx_offset);
	gy = (imu.gyro.y - gy_offset);
	gz = -(imu.gyro.z - gz_offset);

	ax = imu.accel.x - ax_offset;
	ay = imu.accel.y - ay_offset;
	az = imu.accel.z - (az_offset - 1);
}

void calculateAngle(float dt) {		// 500Hz
	float roll_acc = atan2(ay, sqrt(ax * ax + az * az)) * 57.2958;
	float pitch_acc = atan2(-ax, sqrt(ay * ay + az * az)) * 57.2958;
//  ================= KALMAN FILTER =================
	Kalman1D_Compute(roll, KalmanUncertaintyAngleRoll, gx, roll_acc, dt);
	roll = Kalman1DOutput[0];
	KalmanUncertaintyAngleRoll = Kalman1DOutput[1];

	Kalman1D_Compute(pitch, KalmanUncertaintyAnglePitch, gy, pitch_acc, dt);
	pitch = Kalman1DOutput[0];
	KalmanUncertaintyAnglePitch = Kalman1DOutput[1];

	//---------------- Yaw ----------------- //
	// 1. Predict bằng gyro
	static uint8_t mag_div = 0;
	static float heading_lpf = 0.0f;

	yaw += gz * dt;

	float heading = readHeading(roll, pitch);

	float mag_err = angle_diff(heading, heading_lpf);

	heading_lpf += 0.1f * mag_err;

	if (heading_lpf > 180.0f)
		heading_lpf -= 360.0f;

	if (heading_lpf < -180.0f)
		heading_lpf += 360.0f;

	float err = angle_diff(heading_lpf, yaw);

	yaw += 0.01f * err;
//	yaw = heading;
	// Wrap yaw
	if (yaw > 180.0f)
		yaw -= 360.0f;

	if (yaw < -180.0f)
		yaw += 360.0f;

}

#define GPS_POS_R      2.5f
#define KI_GPS_BIAS    0.02f   // hệ số học bias — BẮT ĐẦU NHỎ, tune tăng dần
#define MAX_ACCEL_BIAS 1.0f    // m/s^2, chặn để tránh runaway khi GPS jump/nhiễu

float lat_err, lon_err;
float pos_N, pos_E;
double home_lat, home_lon;
uint8_t robot_armed = 0;
uint8_t robot_start = 0;
uint8_t gps_home_set = 0;

void Estimate_Position_GPS_Kalman(float dt) {
	/*=============================
	 1. Xoay gia tốc từ Body -> Earth Frame
	 =============================*/
	/* Covert FLU to FRD*/
	float ax_frd = ax;
	float ay_frd = -ay;
	float az_frd = -az;

	float cy = cosf(yaw * DEG_TO_RAD);
	float sy = sinf(yaw * DEG_TO_RAD);

	float cp = cosf(pitch * DEG_TO_RAD);
	float sp = sinf(pitch * DEG_TO_RAD);

	float cr = cosf(roll * DEG_TO_RAD);
	float sr = sinf(roll * DEG_TO_RAD);
	/*========================================
	 * FRD -> NED
	 *========================================*/

	ax_earth = cy * cp * ax_frd + (-cy * sp * sr - sy * cr) * ay_frd
			+ (-cy * sp * cr + sy * sr) * az_frd;

	ay_earth = sy * cp * ax_frd + (-sy * sp * sr + cy * cr) * ay_frd
			+ (-sy * sp * cr - cy * sr) * az_frd;

	/* g -> m/s² */
	ax_earth *= 9.81f;
	ay_earth *= 9.81f;

	/*=============================
	 2. Kalman PREDICT (500Hz - IMU)
	 =============================*/
	KalmanGPS_Predict(&kf_North, ax_earth, dt);
	KalmanGPS_Predict(&kf_East, ay_earth, dt);

	/*=============================
	 3. Kalman UPDATE (Chạy ~10Hz bằng GPS)
	 =============================*/
	if (gps.fixType >= 3 && gps.ready == 1) {
		if (!gps_home_set) {
			home_lat = gps.latitude;
			home_lon = gps.longitude;
			gps_home_set = 1;

			// Reset trạng thái
			kf_North.pos = 0.0f;
			kf_North.vel = 0.0f;
			kf_North.bias = 0.0f;
			kf_East.pos = 0.0f;
			kf_East.vel = 0.0f;
			kf_East.bias = 0.0f;

		} else {
			lat_err = (float) gps.latitude - home_lat;
			lon_err = (float) gps.longitude - home_lon;

			pos_N = lat_err * 111320.0f;
			pos_E = lon_err * 111320.0f * cosf(home_lat * DEG_TO_RAD);

			float vel_N = (float) gps.velN / 1000.0f;
			float vel_E = (float) gps.velE / 1000.0f;

			// Bình phương biến số sai số GPS để làm nhiễu (Ví dụ pAcc báo sai số 1.5m -> r = 1.5*1.5)
			float r_pos_noise = (float) (gps.hAcc / 1000.0f)
					* (gps.hAcc / 1000.0f);
			float r_vel_noise = (float) (gps.sAcc / 1000.0f)
					* (gps.sAcc / 1000.0f);

			KalmanGPS_Update(&kf_North, pos_N, vel_N, r_pos_noise, r_vel_noise);
			KalmanGPS_Update(&kf_East, pos_E, vel_E, r_pos_noise, r_vel_noise);
		}
		gps.ready = 0;
	}

	/* 4. Gán State cho hàm PID Position Hold */
	est_x = kf_North.pos;
	est_vx = kf_North.vel;
	est_y = kf_East.pos;
	est_vy = kf_East.vel;
}

uint16_t current_wp_index = 0;
uint8_t mission_running = 0;
#define WAYPOINT_RADIUS 2.0f // Bán kính 2 mét để xác nhận đã đến điểm

#define MAX_NAV_SPEED 5.0f // Tốc độ di chuyển tối đa của máy bay (m/s)

#ifndef constrain
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
#endif
//
//void navigation_task(float dt) {
//	static uint8_t mission_complete = 0;
//	static uint16_t current_wp_index = 0;
//
//	// Đảm bảo GPS đã có sóng, chốt được Home (gps_home_set) và nhận nhiệm vụ
//	if (Mission_IsReady() && gps_home_set && !mission_complete) {
//		Waypoint_t target_wp = Mission_GetWaypoint(current_wp_index);
//		robot_start = 1;
//		// 1. Quy đổi tọa độ Waypoint (Đích) sang hệ mét so với Home (Earth Frame: X=North, Y=East)
//		float wp_lat_err = (float) target_wp.lat - home_lat;
//		float wp_lon_err = (float) target_wp.lon - home_lon;
//
//		float wp_target_x = wp_lat_err * 111320.0f;
//		float wp_target_y = wp_lon_err * 111320.0f
//				* cosf(home_lat * DEG_TO_RAD);
//
//		// 2. Dùng vị trí ƯỚC LƯỢNG (est_x, est_y) để tính khoảng cách thay vì GPS thô
//		float dx = wp_target_x - est_x;
//		float dy = wp_target_y - est_y;
//		float dist_to_target = sqrtf(dx * dx + dy * dy);
//
//		// 3. Kiểm tra xem đã đến đích chưa (Bán kính 2.0m)
//		if (dist_to_target < 2.0f) {
//			current_wp_index++;
//			if (current_wp_index >= Mission_GetCount()) {
//				mission_complete = 1;
//				set_speed(0, 0); // Hoàn thành nhiệm vụ thì dừng động cơ
//				return;
//			}
//		} else {
//			// 4. Tính góc Bearing mục tiêu dựa trên độ lệch (dx, dy)
//			// Trục X hướng Bắc, Y hướng Đông -> atan2f(dy, dx) trả về góc chuẩn xác
//			target_yaw = atan2f(dy, dx) * RAD_TO_DEG;
//			float error = angle_diff(target_yaw, yaw);
//
//			// 5. Tính toán bộ điều khiển PID Steering
//			float pid_output = PID_Calculate(&PID_Rate_Yaw, error, dt);
//
//			if (fabs(error) > 40.0f) {
//				base_speed = 0; // Xoay tại chỗ nếu đầu xe lệch quá nhiều so với Waypoint
//			} else {
//				if (dist_to_target < 4.0f) {
//					base_speed = 200; // Khi cách đích dưới 4m, bắt đầu giảm tốc độ hành trình (Phanh mềm)
//				} else {
//					base_speed = 400;
//				}
//			}
//
//			// Phân bổ tốc độ cho bánh trái và bánh phải
//			left_speed = base_speed + pid_output;
//			right_speed = base_speed - pid_output;
//
//			left_speed = constrain(left_speed, -300, 999);
//			right_speed = constrain(right_speed, -300, 999);
//
//			set_speed(left_speed, right_speed);
//		}
//	} else if (mission_complete) {
//		set_speed(0, 0);
//	}
//}

float dist = 0;

//uint8_t navigation_task(float dt) {		// 1: completed, 0: not completed
//	static uint8_t mission_complete = 0;
//	static uint16_t current_wp_index = 0;
//	if (Mission_IsReady() && !mission_complete && gps.numSV >= 20) {
//		Waypoint_t target_wp = Mission_GetWaypoint(current_wp_index);
//		float dist_to_target = calculate_distance(gps.latitude, gps.longitude,
//				target_wp.lat, target_wp.lon);
//		dist = dist_to_target;
//		if (dist_to_target < 1.0)		// distance <1m then go to next waypoint
//				{
//			current_wp_index++;
//			if (current_wp_index >= Mission_GetCount()) {
//				mission_complete = 1;
//				set_speed(0, 0);
//				return 1;
//			}
//		} else {
//			target_yaw = calculate_bearing(gps.latitude, gps.longitude,
//					target_wp.lat, target_wp.lon);
//			float error = angle_diff(target_yaw, yaw);
//
////			base_speed = 400;
//			float pid_output = PID_Calculate(&PID_Rate_Yaw, error, dt);
//			left_speed = base_speed + pid_output;
//			right_speed = base_speed - pid_output;
//			if (left_speed > 999)
//				left_speed = 999;
//			if (left_speed < -300)
//				left_speed = -300;
//			if (right_speed > 999)
//				right_speed = 999;
//			if (right_speed < -300)
//				right_speed = -300;
//
//			set_speed(left_speed, right_speed);
//
//		}
//	}
//	return 0;
//}

static uint8_t mission_complete = 0;
uint8_t navigation_task(float dt) {
	// Lưu lại tọa độ điểm bắt đầu của đoạn đường (Previous Waypoint)
	static double prev_lat = 0;
	static double prev_lon = 0;
	static uint8_t path_init = 0;

	if (Mission_IsReady() && !mission_complete && gps.numSV >= 20) {
		if (!path_init) {
			prev_lat = gps.latitude; // Điểm xuất phát của chặng đầu tiên
			prev_lon = gps.longitude;
			path_init = 1;
		}

		Waypoint_t target_wp = Mission_GetWaypoint(current_wp_index);
		float dist_to_target = calculate_distance(gps.latitude, gps.longitude,
				target_wp.lat, target_wp.lon);
		dist = dist_to_target;

		if (dist_to_target < 1.0f) { // Đã đến đích, chuyển WP
			current_wp_index++;
			if (current_wp_index >= Mission_GetCount()) {
				mission_complete = 1;
				current_wp_index = 0;
				path_init = 0;
				set_speed(0, 0);
				return 1;
			} else {
				// Đích của chặng cũ trở thành điểm xuất phát của chặng mới
				prev_lat = target_wp.lat;
				prev_lon = target_wp.lon;
			}
		} else {
			// 1. Chuyển đổi tọa độ đoạn đường lý tưởng sang hệ mét (Flat Earth)
			float path_x = (target_wp.lat - prev_lat) * 111320.0f;
			float path_y = (target_wp.lon - prev_lon) * 111320.0f
					* cosf(prev_lat * DEG_TO_RAD);

			// 2. Chuyển đổi vị trí xe hiện tại so với điểm xuất phát
			float curr_x = (gps.latitude - prev_lat) * 111320.0f;
			float curr_y = (gps.longitude - prev_lon) * 111320.0f
					* cosf(prev_lat * DEG_TO_RAD);

			float path_length = sqrtf(path_x * path_x + path_y * path_y);

			if (path_length > 0.001f) {
				// Vector đơn vị của đoạn đường
				float u_x = path_x / path_length;
				float u_y = path_y / path_length;

				// Tính khoảng cách hình chiếu của xe lên đoạn đường
				float proj_dist = curr_x * u_x + curr_y * u_y;

				// Tạo Điểm Ảo cách vị trí chiếu một khoảng Lookahead
				float lookahead = 3.0f; // Mét (Tăng/giảm tùy vận tốc xe)
				float virtual_dist = proj_dist + lookahead;

				// Không để điểm ảo vượt quá đích
				if (virtual_dist > path_length)
					virtual_dist = path_length;

				// Tọa độ Điểm Ảo
				float virt_x = virtual_dist * u_x;
				float virt_y = virtual_dist * u_y;

				// Tính góc Bearing từ xe trỏ đến Điểm Ảo
				float dx = virt_x - curr_x;
				float dy = virt_y - curr_y;
				target_yaw = atan2f(dy, dx) * RAD_TO_DEG;
			} else {
				target_yaw = calculate_bearing(gps.latitude, gps.longitude,
						target_wp.lat, target_wp.lon);
			}

			float error = angle_diff(target_yaw, yaw);
			float pid_output = PID_Calculate(&PID_Rate_Yaw, error, dt);

			left_speed = base_speed + pid_output;
			right_speed = base_speed - pid_output;

			// Sử dụng macro constrain sẵn có để giới hạn tốc độ PWM
			left_speed = constrain(left_speed, -300, 999);
			right_speed = constrain(right_speed, -300, 999);

			set_speed(left_speed, right_speed);
		}
	}
	return 0;
}

void Calibrate_Gyro(void) {
	float sum_gx = 0, sum_gy = 0, sum_gz = 0;
	float sum_ax = 0, sum_ay = 0, sum_az = 0;
	int samples = 100;

	for (int i = 0; i < samples; i++) {
		ICM20602_Read(&imu);
		sum_gx += imu.gyro.x;
		sum_gy += imu.gyro.y;
		sum_gz += imu.gyro.z;
		sum_ax += imu.accel.x;
		sum_ay += imu.accel.y;
		sum_az += imu.accel.z;
		HAL_Delay(2); // Chờ một chút giữa các lần đọc
	}

	gx_offset = sum_gx / samples;
	gy_offset = sum_gy / samples;
	gz_offset = sum_gz / samples;

	ax_offset = sum_ax / samples;
	ay_offset = sum_ay / samples;
	az_offset = sum_az / samples;
}

uint32_t lastHeartbeatTime = 0;
uint32_t lastTelemetryTime = 0;

float mapf(float x, float in_min, float in_max, float out_min, float out_max) {
	return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}
void sendHeartbeat(void) {
	// 1. Thêm từ khóa static để mảng không bị hủy sau khi thoát hàm
	static char hb_tx_buf[96];

	// 2. Kiểm tra xem UART có đang bận gửi gói dữ liệu khác không
	if (huart3.gState != HAL_UART_STATE_READY)
		return;

	snprintf(hb_tx_buf, sizeof(hb_tx_buf), "{\"type\":\"heartbeat\"}\n");

	// 3. Sử dụng hàm DMA (không cần tham số timeout)
	HAL_UART_Transmit_DMA(&huart3, (uint8_t*) hb_tx_buf, strlen(hb_tx_buf));
}

float yaw_send = 0;
void sendTelemetry() {
	static char tele_tx_buf[256]; // Dùng static

	if (huart3.gState != HAL_UART_STATE_READY)
		return;

	const char *state_str = "DISARMED";
	if (robot_armed) {
		if (robot_start) {
			state_str = "RUNNING";
		} else {
			state_str = "ARMED";
		}
	}
//	yaw_send = mapf(yaw, -180, 180, , 360);
	yaw_send = yaw;
	if (yaw < 0) {
		yaw_send = 360 + yaw;
	}

	snprintf(tele_tx_buf, sizeof(tele_tx_buf),
			"{\"type\":\"telemetry\",\"lat\":%.7f,\"lon\":%.7f,\"heading\":%.1f,\"speed\":%.1f,\"battery\":%.1f,\"altitude\":%.1f,\"satellites\":%d,\"armed\":%s,\"state\":\"%s\"}\n",
			gps.latitude, gps.longitude, yaw_send,
			(float) (gps.gSpeed / 1000.0f), battery, 0.0, gps.numSV,
			robot_armed ? "true" : "false", state_str);
	trans_flag = 1;
	HAL_UART_Transmit_DMA(&huart3, (uint8_t*) tele_tx_buf, strlen(tele_tx_buf));
	trans_flag = 0;
}

/* USER CODE END 0 */

/**
 * @brief  The application entry point.
 * @retval int
 */
int main(void) {

	/* USER CODE BEGIN 1 */

	/* USER CODE END 1 */

	/* MCU Configuration--------------------------------------------------------*/

	/* Reset of all peripherals, Initializes the Flash interface and the Systick. */
	HAL_Init();

	/* USER CODE BEGIN Init */

	/* USER CODE END Init */

	/* Configure the system clock */
	SystemClock_Config();

	/* USER CODE BEGIN SysInit */

	/* USER CODE END SysInit */

	/* Initialize all configured peripherals */
	MX_GPIO_Init();
	MX_DMA_Init();
	MX_I2C1_Init();
	MX_SPI1_Init();
	MX_USART1_UART_Init();
	MX_USART2_UART_Init();
	MX_USART3_UART_Init();
	MX_TIM3_Init();
	/* USER CODE BEGIN 2 */
	HAL_TIM_PWM_Start(&htim3, LPWM_1);
	HAL_TIM_PWM_Start(&htim3, RPWM_1);
	HAL_TIM_PWM_Start(&htim3, LPWM_2);
	HAL_TIM_PWM_Start(&htim3, RPWM_2);

	DWT_Init();
	INA219_Init(&hi2c1);
	ICM20602_Init();
	IST8310_Init(&hi2c1, &ist8310);
	GPS_Init_DMA(&huart1);
	Mission_Init_DMA(&huart3);
	PID_Init(&PID_Rate_Yaw, kp_y, ki_y, kd_y, 0.2f);
	PID_SetIntegralLimits(&PID_Rate_Yaw, -300.0f, 300.0f);
	Calibrate_Gyro();
//	IST8310_Calibrate(&hi2c1, 90000);
	HAL_Delay(100);
	while (!HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0)) {

	}

	uint32_t tele_timer = 0;
	uint32_t heatbeart_timer = 0;
	/* USER CODE END 2 */

	/* Infinite loop */
	/* USER CODE BEGIN WHILE */
	while (1) {
		/* USER CODE END WHILE */

		/* USER CODE BEGIN 3 */
		uint32_t start = DWT_GetMicros();
		float dt = 0.004f;
		readIMU();
		calculateAngle(dt);

		if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0)) {
			target_yaw = yaw;
		}
		GPS_Process(&gps);
		Estimate_Position_GPS_Kalman(dt);
		if ((DWT_GetMicros() - heatbeart_timer > 1000000)) {
			sendHeartbeat();
			heatbeart_timer = DWT_GetMicros();
		}
		if ((DWT_GetMicros() - tele_timer > 500000)) {
			float vol = INA219_Read_Bus_Voltage(&hi2c1);
			vol = constrain(vol, 10.5, 12.6);
			battery = mapf(vol, 10.5, 12.6, 0, 100);

			sendTelemetry();
			tele_timer = DWT_GetMicros();
		}
		if (!robot_armed) {
			// TRẠNG THÁI 1: ĐÃ KHÓA (DISARMED)
			// Ép tốc độ động cơ về 0 hoàn toàn
			set_speed(0, 0);
		} else if (robot_armed && !robot_start) {
			// TRẠNG THÁI 2: MỞ KHÓA NHƯNG ĐỨNG YÊN (ARMED)
			// Sẵn sàng chạy nhưng chưa nhận lệnh Start
			set_speed(5, 5);
		} else if (robot_armed && robot_start) {
			// TRẠNG THÁI 3: ĐANG CHẠY NHIỆM VỤ (RUNNING)
			// Cho phép thuật toán Navigation điều khiển tốc độ
			uint8_t completed = navigation_task(dt);
			if (completed) {
				robot_start = 0;
				robot_armed = 0;
				mission_complete = 0;

			}
		}

		while ((DWT_GetMicros() - start) < 4000)
			;
	}
	/* USER CODE END 3 */
}

/**
 * @brief System Clock Configuration
 * @retval None
 */
void SystemClock_Config(void) {
	RCC_OscInitTypeDef RCC_OscInitStruct = { 0 };
	RCC_ClkInitTypeDef RCC_ClkInitStruct = { 0 };

	/** Configure the main internal regulator output voltage
	 */
	__HAL_RCC_PWR_CLK_ENABLE();
	__HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE1);

	/** Initializes the RCC Oscillators according to the specified parameters
	 * in the RCC_OscInitTypeDef structure.
	 */
	RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
	RCC_OscInitStruct.HSIState = RCC_HSI_ON;
	RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
	RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
	RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSI;
	RCC_OscInitStruct.PLL.PLLM = 8;
	RCC_OscInitStruct.PLL.PLLN = 80;
	RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV2;
	RCC_OscInitStruct.PLL.PLLQ = 4;
	if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK) {
		Error_Handler();
	}

	/** Initializes the CPU, AHB and APB buses clocks
	 */
	RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
			| RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
	RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
	RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
	RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
	RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV2;

	if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK) {
		Error_Handler();
	}
}

/**
 * @brief I2C1 Initialization Function
 * @param None
 * @retval None
 */
static void MX_I2C1_Init(void) {

	/* USER CODE BEGIN I2C1_Init 0 */

	/* USER CODE END I2C1_Init 0 */

	/* USER CODE BEGIN I2C1_Init 1 */

	/* USER CODE END I2C1_Init 1 */
	hi2c1.Instance = I2C1;
	hi2c1.Init.ClockSpeed = 400000;
	hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
	hi2c1.Init.OwnAddress1 = 0;
	hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
	hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
	hi2c1.Init.OwnAddress2 = 0;
	hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
	hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
	if (HAL_I2C_Init(&hi2c1) != HAL_OK) {
		Error_Handler();
	}
	/* USER CODE BEGIN I2C1_Init 2 */

	/* USER CODE END I2C1_Init 2 */

}

/**
 * @brief SPI1 Initialization Function
 * @param None
 * @retval None
 */
static void MX_SPI1_Init(void) {

	/* USER CODE BEGIN SPI1_Init 0 */

	/* USER CODE END SPI1_Init 0 */

	/* USER CODE BEGIN SPI1_Init 1 */

	/* USER CODE END SPI1_Init 1 */
	/* SPI1 parameter configuration*/
	hspi1.Instance = SPI1;
	hspi1.Init.Mode = SPI_MODE_MASTER;
	hspi1.Init.Direction = SPI_DIRECTION_2LINES;
	hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
	hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
	hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
	hspi1.Init.NSS = SPI_NSS_SOFT;
	hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_2;
	hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
	hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
	hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
	hspi1.Init.CRCPolynomial = 10;
	if (HAL_SPI_Init(&hspi1) != HAL_OK) {
		Error_Handler();
	}
	/* USER CODE BEGIN SPI1_Init 2 */

	/* USER CODE END SPI1_Init 2 */

}

/**
 * @brief TIM3 Initialization Function
 * @param None
 * @retval None
 */
static void MX_TIM3_Init(void) {

	/* USER CODE BEGIN TIM3_Init 0 */

	/* USER CODE END TIM3_Init 0 */

	TIM_MasterConfigTypeDef sMasterConfig = { 0 };
	TIM_OC_InitTypeDef sConfigOC = { 0 };

	/* USER CODE BEGIN TIM3_Init 1 */

	/* USER CODE END TIM3_Init 1 */
	htim3.Instance = TIM3;
	htim3.Init.Prescaler = 3;
	htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
	htim3.Init.Period = 999;
	htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
	htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
	if (HAL_TIM_PWM_Init(&htim3) != HAL_OK) {
		Error_Handler();
	}
	sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
	sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
	if (HAL_TIMEx_MasterConfigSynchronization(&htim3, &sMasterConfig)
			!= HAL_OK) {
		Error_Handler();
	}
	sConfigOC.OCMode = TIM_OCMODE_PWM1;
	sConfigOC.Pulse = 0;
	sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
	sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;
	if (HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_1)
			!= HAL_OK) {
		Error_Handler();
	}
	if (HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_2)
			!= HAL_OK) {
		Error_Handler();
	}
	if (HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_3)
			!= HAL_OK) {
		Error_Handler();
	}
	if (HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_4)
			!= HAL_OK) {
		Error_Handler();
	}
	/* USER CODE BEGIN TIM3_Init 2 */

	/* USER CODE END TIM3_Init 2 */
	HAL_TIM_MspPostInit(&htim3);

}

/**
 * @brief USART1 Initialization Function
 * @param None
 * @retval None
 */
static void MX_USART1_UART_Init(void) {

	/* USER CODE BEGIN USART1_Init 0 */

	/* USER CODE END USART1_Init 0 */

	/* USER CODE BEGIN USART1_Init 1 */

	/* USER CODE END USART1_Init 1 */
	huart1.Instance = USART1;
	huart1.Init.BaudRate = 115200;
	huart1.Init.WordLength = UART_WORDLENGTH_8B;
	huart1.Init.StopBits = UART_STOPBITS_1;
	huart1.Init.Parity = UART_PARITY_NONE;
	huart1.Init.Mode = UART_MODE_TX_RX;
	huart1.Init.HwFlowCtl = UART_HWCONTROL_NONE;
	huart1.Init.OverSampling = UART_OVERSAMPLING_16;
	if (HAL_UART_Init(&huart1) != HAL_OK) {
		Error_Handler();
	}
	/* USER CODE BEGIN USART1_Init 2 */

	/* USER CODE END USART1_Init 2 */

}

/**
 * @brief USART2 Initialization Function
 * @param None
 * @retval None
 */
static void MX_USART2_UART_Init(void) {

	/* USER CODE BEGIN USART2_Init 0 */

	/* USER CODE END USART2_Init 0 */

	/* USER CODE BEGIN USART2_Init 1 */

	/* USER CODE END USART2_Init 1 */
	huart2.Instance = USART2;
	huart2.Init.BaudRate = 115200;
	huart2.Init.WordLength = UART_WORDLENGTH_8B;
	huart2.Init.StopBits = UART_STOPBITS_1;
	huart2.Init.Parity = UART_PARITY_NONE;
	huart2.Init.Mode = UART_MODE_TX_RX;
	huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
	huart2.Init.OverSampling = UART_OVERSAMPLING_16;
	if (HAL_UART_Init(&huart2) != HAL_OK) {
		Error_Handler();
	}
	/* USER CODE BEGIN USART2_Init 2 */

	/* USER CODE END USART2_Init 2 */

}

/**
 * @brief USART3 Initialization Function
 * @param None
 * @retval None
 */
static void MX_USART3_UART_Init(void) {

	/* USER CODE BEGIN USART3_Init 0 */

	/* USER CODE END USART3_Init 0 */

	/* USER CODE BEGIN USART3_Init 1 */

	/* USER CODE END USART3_Init 1 */
	huart3.Instance = USART3;
	huart3.Init.BaudRate = 115200;
	huart3.Init.WordLength = UART_WORDLENGTH_8B;
	huart3.Init.StopBits = UART_STOPBITS_1;
	huart3.Init.Parity = UART_PARITY_NONE;
	huart3.Init.Mode = UART_MODE_TX_RX;
	huart3.Init.HwFlowCtl = UART_HWCONTROL_NONE;
	huart3.Init.OverSampling = UART_OVERSAMPLING_16;
	if (HAL_UART_Init(&huart3) != HAL_OK) {
		Error_Handler();
	}
	/* USER CODE BEGIN USART3_Init 2 */

	/* USER CODE END USART3_Init 2 */

}

/**
 * Enable DMA controller clock
 */
static void MX_DMA_Init(void) {

	/* DMA controller clock enable */
	__HAL_RCC_DMA2_CLK_ENABLE();
	__HAL_RCC_DMA1_CLK_ENABLE();

	/* DMA interrupt init */
	/* DMA1_Stream1_IRQn interrupt configuration */
	HAL_NVIC_SetPriority(DMA1_Stream1_IRQn, 0, 0);
	HAL_NVIC_EnableIRQ(DMA1_Stream1_IRQn);
	/* DMA1_Stream3_IRQn interrupt configuration */
	HAL_NVIC_SetPriority(DMA1_Stream3_IRQn, 0, 0);
	HAL_NVIC_EnableIRQ(DMA1_Stream3_IRQn);
	/* DMA1_Stream5_IRQn interrupt configuration */
	HAL_NVIC_SetPriority(DMA1_Stream5_IRQn, 0, 0);
	HAL_NVIC_EnableIRQ(DMA1_Stream5_IRQn);
	/* DMA2_Stream2_IRQn interrupt configuration */
	HAL_NVIC_SetPriority(DMA2_Stream2_IRQn, 0, 0);
	HAL_NVIC_EnableIRQ(DMA2_Stream2_IRQn);

}

/**
 * @brief GPIO Initialization Function
 * @param None
 * @retval None
 */
static void MX_GPIO_Init(void) {
	GPIO_InitTypeDef GPIO_InitStruct = { 0 };
	/* USER CODE BEGIN MX_GPIO_Init_1 */

	/* USER CODE END MX_GPIO_Init_1 */

	/* GPIO Ports Clock Enable */
	__HAL_RCC_GPIOA_CLK_ENABLE();
	__HAL_RCC_GPIOB_CLK_ENABLE();
	__HAL_RCC_GPIOE_CLK_ENABLE();
	__HAL_RCC_GPIOD_CLK_ENABLE();
	__HAL_RCC_GPIOC_CLK_ENABLE();

	/*Configure GPIO pin Output Level */
	HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_RESET);

	/*Configure GPIO pin : PA0 */
	GPIO_InitStruct.Pin = GPIO_PIN_0;
	GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

	/*Configure GPIO pin : PA4 */
	GPIO_InitStruct.Pin = GPIO_PIN_4;
	GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
	HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

	/*Configure GPIO pins : PB0 PB1 */
	GPIO_InitStruct.Pin = GPIO_PIN_0 | GPIO_PIN_1;
	GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

	/*Configure GPIO pins : PE11 PE13 */
	GPIO_InitStruct.Pin = GPIO_PIN_11 | GPIO_PIN_13;
	GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
	GPIO_InitStruct.Alternate = GPIO_AF1_TIM1;
	HAL_GPIO_Init(GPIOE, &GPIO_InitStruct);

	/*Configure GPIO pins : PD12 PD13 */
	GPIO_InitStruct.Pin = GPIO_PIN_12 | GPIO_PIN_13;
	GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
	GPIO_InitStruct.Alternate = GPIO_AF2_TIM4;
	HAL_GPIO_Init(GPIOD, &GPIO_InitStruct);

	/*Configure GPIO pin : PA15 */
	GPIO_InitStruct.Pin = GPIO_PIN_15;
	GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
	GPIO_InitStruct.Alternate = GPIO_AF1_TIM2;
	HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

	/*Configure GPIO pin : PB3 */
	GPIO_InitStruct.Pin = GPIO_PIN_3;
	GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
	GPIO_InitStruct.Alternate = GPIO_AF1_TIM2;
	HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

	/* USER CODE BEGIN MX_GPIO_Init_2 */

	/* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

/* USER CODE END 4 */

/**
 * @brief  This function is executed in case of error occurrence.
 * @retval None
 */
void Error_Handler(void) {
	/* USER CODE BEGIN Error_Handler_Debug */
	/* User can add his own implementation to report the HAL error return state */
	__disable_irq();
	while (1) {
	}
	/* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
