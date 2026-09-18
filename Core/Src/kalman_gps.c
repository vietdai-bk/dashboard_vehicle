
#include "kalman_gps.h"

void KalmanGPS_Init(KalmanFilter1D_t *kf, float init_pos, float init_vel,
		float q_accel, float q_bias) {
	kf->pos = init_pos;
	kf->vel = init_vel;
	kf->bias = 0.0f;

	kf->Q_accel = q_accel;
	kf->Q_bias = q_bias;

	// Khởi tạo ma trận P (đường chéo = 1, còn lại = 0)
	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 3; j++) {
			kf->P[i][j] = (i == j) ? 1.0f : 0.0f;
		}
	}
}


void KalmanGPS_Predict(KalmanFilter1D_t *kf, float accel_earth, float dt) {
	float acc = accel_earth - kf->bias;

	/* =========================
	 * 1. State prediction
	 * ========================= */

	kf->pos += kf->vel * dt + 0.5f * acc * dt * dt;

	kf->vel += acc * dt;

	/* =========================
	 * 2. State transition matrix
	 *
	 * x = [pos vel bias]
	 *
	 * pos' = pos + vel*dt - 0.5*bias*dt²
	 * vel' = vel - bias*dt
	 * bias'= bias
	 * ========================= */

	float F[3][3] = { { 1.0f, dt, -0.5f * dt * dt }, { 0.0f, 1.0f, -dt }, {
			0.0f, 0.0f, 1.0f } };

	/* =========================
	 * 3. P = F * P * F'
	 * ========================= */

	float FP[3][3] = { 0 };

	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 3; j++) {

			for (int k = 0; k < 3; k++) {
				FP[i][j] += F[i][k] * kf->P[k][j];
			}
		}
	}

	float Pnew[3][3] = { 0 };

	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 3; j++) {

			for (int k = 0; k < 3; k++) {
				Pnew[i][j] += FP[i][k] * F[j][k];
			}
		}
	}

	/* =========================
	 * 4. Process noise
	 * ========================= */

	float dt2 = dt * dt;
	float dt3 = dt2 * dt;
	float dt4 = dt2 * dt2;

	Pnew[0][0] += 0.25f * dt4 * kf->Q_accel;
	Pnew[0][1] += 0.5f * dt3 * kf->Q_accel;
	Pnew[1][0] += 0.5f * dt3 * kf->Q_accel;
	Pnew[1][1] += dt2 * kf->Q_accel;

	Pnew[2][2] += kf->Q_bias * dt;

	/* =========================
	 * 5. Copy back
	 * ========================= */

	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 3; j++) {
			kf->P[i][j] = Pnew[i][j];
		}
	}
}

void KalmanGPS_Update(KalmanFilter1D_t *kf, float gps_pos, float gps_vel,
		float r_pos, float r_vel) {
	// 1. Tính độ lệch (Innovation = Measurement - Prediction)
	float y_pos = gps_pos - kf->pos;
	float y_vel = gps_vel - kf->vel;

	// 2. Tính ma trận S (S = H*P*H^T + R)
	float S00 = kf->P[0][0] + r_pos;
	float S01 = kf->P[0][1];
	float S10 = kf->P[1][0];
	float S11 = kf->P[1][1] + r_vel;

	// Nghịch đảo của ma trận S (2x2)
	float det = S00 * S11 - S01 * S10;
	if (det < 1e-6f)
		return; // Bảo vệ chia cho 0 hoặc S suy biến

	float invS00 = S11 / det;
	float invS01 = -S01 / det;
	float invS10 = -S10 / det;
	float invS11 = S00 / det;

	// 3. Tính Kalman Gain K (Ma trận 3x2 = P * H^T * S^-1)
	float K[3][2];
	for (int i = 0; i < 3; i++) {
		K[i][0] = kf->P[i][0] * invS00 + kf->P[i][1] * invS10;
		K[i][1] = kf->P[i][0] * invS01 + kf->P[i][1] * invS11;
	}

	// 4. Sửa sai cho trạng thái (X = X + K*Y)
	kf->pos += K[0][0] * y_pos + K[0][1] * y_vel;
	kf->vel += K[1][0] * y_pos + K[1][1] * y_vel;
	kf->bias += K[2][0] * y_pos + K[2][1] * y_vel; // Tự động nhận diện và sửa sai số phần cứng IMU

	// 5. Cập nhật lại ma trận P (P = (I - K*H)*P)
	float P_new[3][3];
	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 3; j++) {
			P_new[i][j] = kf->P[i][j]
					- (K[i][0] * kf->P[0][j] + K[i][1] * kf->P[1][j]);
		}
	}

	// Ghi đè P cũ bằng P mới
	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 3; j++) {
			kf->P[i][j] = P_new[i][j];
		}
	}
}
