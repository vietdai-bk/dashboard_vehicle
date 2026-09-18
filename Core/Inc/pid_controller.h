/*
 * pid_controller.h
 *
 *  Created on: Aug 24, 2026
 *      Author: lethanhtra
 */

#ifndef INC_PID_CONTROLLER_H_
#define INC_PID_CONTROLLER_H_


#include "stm32f4xx_hal.h"

typedef struct
{
    float kp;
    float ki;
    float kd;

    float preE;
    float preI;

    // Low-pass filter cho D
    float preD;
    float alphaD;

    // Giới hạn tích phân
    float iMin;
    float iMax;

} PIDController_t;

void PID_SetIntegralLimits(PIDController_t *pid, float iMin, float iMax);

void PID_Init(PIDController_t *pid,
              float kp,
              float ki,
              float kd,
              float alpha);

float PID_Calculate(PIDController_t *pid,
                    float error,
                    float dt);

void PID_Reset(PIDController_t *pid);

void PID_SetGain(PIDController_t *pid,
                 float kp,
                 float ki,
                 float kd);


#endif /* INC_PID_CONTROLLER_H_ */
