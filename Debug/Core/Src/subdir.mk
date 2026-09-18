################################################################################
# Automatically-generated file. Do not edit!
# Toolchain: GNU Tools for STM32 (13.3.rel1)
################################################################################

# Add inputs and outputs from these tool invocations to the build variables 
C_SRCS += \
../Core/Src/cJSON.c \
../Core/Src/dwt.c \
../Core/Src/gps.c \
../Core/Src/icm20602.c \
../Core/Src/ina219.c \
../Core/Src/ist8310.c \
../Core/Src/kalman.c \
../Core/Src/kalman_gps.c \
../Core/Src/main.c \
../Core/Src/mission.c \
../Core/Src/navigation.c \
../Core/Src/pid_controller.c \
../Core/Src/stm32f4xx_hal_msp.c \
../Core/Src/stm32f4xx_it.c \
../Core/Src/syscalls.c \
../Core/Src/sysmem.c \
../Core/Src/system_stm32f4xx.c 

OBJS += \
./Core/Src/cJSON.o \
./Core/Src/dwt.o \
./Core/Src/gps.o \
./Core/Src/icm20602.o \
./Core/Src/ina219.o \
./Core/Src/ist8310.o \
./Core/Src/kalman.o \
./Core/Src/kalman_gps.o \
./Core/Src/main.o \
./Core/Src/mission.o \
./Core/Src/navigation.o \
./Core/Src/pid_controller.o \
./Core/Src/stm32f4xx_hal_msp.o \
./Core/Src/stm32f4xx_it.o \
./Core/Src/syscalls.o \
./Core/Src/sysmem.o \
./Core/Src/system_stm32f4xx.o 

C_DEPS += \
./Core/Src/cJSON.d \
./Core/Src/dwt.d \
./Core/Src/gps.d \
./Core/Src/icm20602.d \
./Core/Src/ina219.d \
./Core/Src/ist8310.d \
./Core/Src/kalman.d \
./Core/Src/kalman_gps.d \
./Core/Src/main.d \
./Core/Src/mission.d \
./Core/Src/navigation.d \
./Core/Src/pid_controller.d \
./Core/Src/stm32f4xx_hal_msp.d \
./Core/Src/stm32f4xx_it.d \
./Core/Src/syscalls.d \
./Core/Src/sysmem.d \
./Core/Src/system_stm32f4xx.d 


# Each subdirectory must supply rules for building sources it contributes
Core/Src/%.o Core/Src/%.su Core/Src/%.cyclo: ../Core/Src/%.c Core/Src/subdir.mk
	arm-none-eabi-gcc "$<" -mcpu=cortex-m4 -std=gnu11 -g3 -DDEBUG -DUSE_HAL_DRIVER -DSTM32F407xx -c -I../Core/Inc -I../Drivers/STM32F4xx_HAL_Driver/Inc -I../Drivers/STM32F4xx_HAL_Driver/Inc/Legacy -I../Drivers/CMSIS/Device/ST/STM32F4xx/Include -I../Drivers/CMSIS/Include -O0 -ffunction-sections -fdata-sections -Wall -fstack-usage -fcyclomatic-complexity -MMD -MP -MF"$(@:%.o=%.d)" -MT"$@" --specs=nano.specs -mfpu=fpv4-sp-d16 -mfloat-abi=hard -mthumb -o "$@"

clean: clean-Core-2f-Src

clean-Core-2f-Src:
	-$(RM) ./Core/Src/cJSON.cyclo ./Core/Src/cJSON.d ./Core/Src/cJSON.o ./Core/Src/cJSON.su ./Core/Src/dwt.cyclo ./Core/Src/dwt.d ./Core/Src/dwt.o ./Core/Src/dwt.su ./Core/Src/gps.cyclo ./Core/Src/gps.d ./Core/Src/gps.o ./Core/Src/gps.su ./Core/Src/icm20602.cyclo ./Core/Src/icm20602.d ./Core/Src/icm20602.o ./Core/Src/icm20602.su ./Core/Src/ina219.cyclo ./Core/Src/ina219.d ./Core/Src/ina219.o ./Core/Src/ina219.su ./Core/Src/ist8310.cyclo ./Core/Src/ist8310.d ./Core/Src/ist8310.o ./Core/Src/ist8310.su ./Core/Src/kalman.cyclo ./Core/Src/kalman.d ./Core/Src/kalman.o ./Core/Src/kalman.su ./Core/Src/kalman_gps.cyclo ./Core/Src/kalman_gps.d ./Core/Src/kalman_gps.o ./Core/Src/kalman_gps.su ./Core/Src/main.cyclo ./Core/Src/main.d ./Core/Src/main.o ./Core/Src/main.su ./Core/Src/mission.cyclo ./Core/Src/mission.d ./Core/Src/mission.o ./Core/Src/mission.su ./Core/Src/navigation.cyclo ./Core/Src/navigation.d ./Core/Src/navigation.o ./Core/Src/navigation.su ./Core/Src/pid_controller.cyclo ./Core/Src/pid_controller.d ./Core/Src/pid_controller.o ./Core/Src/pid_controller.su ./Core/Src/stm32f4xx_hal_msp.cyclo ./Core/Src/stm32f4xx_hal_msp.d ./Core/Src/stm32f4xx_hal_msp.o ./Core/Src/stm32f4xx_hal_msp.su ./Core/Src/stm32f4xx_it.cyclo ./Core/Src/stm32f4xx_it.d ./Core/Src/stm32f4xx_it.o ./Core/Src/stm32f4xx_it.su ./Core/Src/syscalls.cyclo ./Core/Src/syscalls.d ./Core/Src/syscalls.o ./Core/Src/syscalls.su ./Core/Src/sysmem.cyclo ./Core/Src/sysmem.d ./Core/Src/sysmem.o ./Core/Src/sysmem.su ./Core/Src/system_stm32f4xx.cyclo ./Core/Src/system_stm32f4xx.d ./Core/Src/system_stm32f4xx.o ./Core/Src/system_stm32f4xx.su

.PHONY: clean-Core-2f-Src

