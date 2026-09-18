/*
 * dwt.h
 *
 *  Created on: Aug 24, 2026
 *      Author: lethanhtra
 */

#ifndef __DWT_H
#define __DWT_H

#include "stm32f4xx_hal.h"

void DWT_Init(void);
float DWT_GetDeltaTime(void);
uint32_t DWT_GetMicros(void);

#endif

