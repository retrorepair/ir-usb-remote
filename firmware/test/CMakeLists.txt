cmake_minimum_required(VERSION 3.13)
project(ir_decode_tests C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# The decoders are deliberately free of SDK dependencies, which is what lets
# them build for the host here. If this ever fails to link because a decoder
# started calling into the SDK, that is the bug -- not this file.
add_executable(ir_decode_tests
    test_decode.c
    ../src/ir_decode.c
    ../src/ir_protocol.c
)

target_include_directories(ir_decode_tests PRIVATE ../include)
target_compile_options(ir_decode_tests PRIVATE -Wall -Wextra -Wno-unused-parameter)

enable_testing()
add_test(NAME decoders COMMAND ir_decode_tests)
