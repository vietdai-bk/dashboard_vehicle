#include "dwt.h"

static uint32_t last_cycle = 0;
static uint32_t cpu_mhz;
static uint64_t total_micros = 0; // Dùng 64-bit để lưu tổng thời gian không sợ tràn

void DWT_Init(void)
{
    // 2. Kích hoạt Trace nâng cao và bộ đếm chu kỳ
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

    // 3. Khởi tạo biến
    last_cycle = 0;
    total_micros = 0;
    cpu_mhz = SystemCoreClock / 1000000U;
}

// Hàm đọc Microseconds chống tràn hoàn hảo (Chạy liên tục nhiều năm không lỗi)
uint32_t DWT_GetMicros(void)
{
    uint32_t now = DWT->CYCCNT;

    // Phép trừ không dấu tự động xử lý lỗi tràn của thanh ghi 32-bit
    uint32_t diff_cycles = now - last_cycle;

    total_micros += (diff_cycles / cpu_mhz);
    last_cycle = now;

    return (uint32_t)total_micros;
}

// Hàm tính Delta Time (Thời gian trôi qua giữa 2 lần gọi hàm)
float DWT_GetDeltaTime(void)
{
    uint32_t now = DWT->CYCCNT;

    // Phép trừ 32-bit không dấu tự xử lý được hiện tượng tràn chu kỳ
    uint32_t cycles = now - last_cycle;
    last_cycle = now;

    return (float)cycles / (float)SystemCoreClock;
}
