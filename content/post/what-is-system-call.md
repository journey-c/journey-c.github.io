---
title: "系统调用"
date: 2020-11-27T20:58:31+08:00
tags:
- 操作系统
- Linux
---

# 1 .简介

系统调用就是操作系统提供给用户态应用与硬件交互的一组接口。在用户空间和硬件之间添加一个中间层(系统调用)主要的作用有:
1. 为用户空间提供抽象接口，用户不需要关心硬件种类介质等。
2. 保障系统的稳定和安全，避免用户错误的使用硬件危害系统或者窃取其他进程的资源。
3. 由于Linux进程都是运行在虚拟系统中，如果操作系统对用户访问硬件一无所知，就几乎无法实现多任务和虚拟内存。

![unix_arch](/images/unix_arch.jpeg)
<div>
	<center>图片来源<a href="https://www.amazon.com/Advanced-Programming-UNIX-Environment-3rd/dp/0321637739">《Advanced Programming in the UNIX Environment, 3rd Edition》</a></center>
</div>

# 2. 三种使用系统调用方式

![syscall_method](/images/syscall_method.png)

## 2.1 软件中断

![interrupt](/images/interrupt.png)

没有外界打扰的情况下处理器会一直执行给定指令，中断就是打断处理器的执行并且告诉他先执行另一段指令，执行完毕再接着执行中断前的指令。从中断指令发出的对象可以分为硬件中断和软件中断。
- 硬件中断就是硬件通过传输电信号到中断控制器的输入引脚，中断控制器收到电信号之后会给处理器发送一个电信号，处理器一经检测到电信号之后就中断当前工作转而处理中断。之后会通知操作系统已经产生中断，进而操作系统可以处理这个中断了。
- 软件中断就是处理器执行特定指令时触发的中断，之后也会通知操作系统。
- 除了系统调用，还有中断下半部tasklet也是用软件中断实现的。

在x86的机器上可以使用$INT$指令触发软件中断，Linux早期的时候就是使用软件中断来处理系统调用，中断号为128。
软件中断执行系统调用的流程为:
1. 用户将中断号放入$eax$寄存器，前六个参数按顺序放入$ebx$、$ecx$、$edx$、$esi$、$edi$、$ebp$寄存器，六个以上的情况，需要把所有参数放在用户空间的一段连续内存中(类似用struct传参)，然后将指向该内存区域的指针放入$ebx$中。
2. 执行$int$ 0x80指令，处理器在中断向量表([IDT](https://en.wikipedia.org/wiki/Interrupt_descriptor_table))中查找对应的中端处理程序，执行中断处理程序(操作系统由ring3进入ring0)[entry_INT80_32](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/entry_32.S#L1052):
	- a. 调用[SAVE_ALL](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/entry_32.S#L1056)将当前上下文保存到内核栈，然后调用[do_int80_syscall_32](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/common.c#L84)。
	- b. [do_int80_syscall_32](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/common.c#L84) 从用户空间进入内核空间然后调用 [do_syscall_32_irqs_on](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/common.c#L72)，退出内核空间返回用户空间。
	- c. [do_syscall_32_irqs_on](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/common.c#L72) 检查系统调用号，从系统调用表[ia32_sys_call_table](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/syscall_32.c#L18) [syscall_32.tbl](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/syscalls/syscall_32.tbl)中找出对应函数，并且将参数传给对应系统调用函数，唤起软件中断，将返回值放入$eax$寄存器。
	- d. 从内核栈恢复上下文。

![interrupt_call](/images/interrupt_call.png)
下面就是一个通过软件中断调用write系统调用的例子:

```x86asm
global _start

section .text
_start:
    mov eax,4      ; system call number
    mov ebx,1      ; args 1: fd=1(STDOUT)
    mov ecx,msg    ; args 2: "Hello World!"
    mov edx,msglen ; args 3: len("Hello World!")
    int 0x80       ; soft interrupt
    mov eax,1      ; syscall exit number
    mov ebx,0      ; args 1: 0 (exit(0))
    int 0x80       ; soft interrupt

section .rodata
    msg: db "Hello, World!", 10
    msglen: equ $ - msg 
```
```bash
nasm -g -f elf64 -o sys_call.o sys_call.s
ld -o sys_call sys_call.o
```

## 2.2 汇编指令
由于中断实现的系统调用在个别处理器上表现非常差，Linux在较新版本上使用了intel和amd上实现的快速系统调用指令syscall/sysret(64)和sysenter/sysexit(32)。这也是目前最常用的系统调用方式。
![asm](/images/asm.png)

具体流程为: 
1. cpu初始化[cpu_init](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/kernel/cpu/common.c#L1869) 调用 [syscall_init](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/kernel/cpu/common.c#L1702)
2. [syscall_init](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/kernel/cpu/common.c#L1702) 将系统调用处理函数[entry_SYSCALL_64](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/entry_64.S#L95)和[entry_SYSENTER_32](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/entry_32.S#L903)注册到[MSR](https://en.wikipedia.org/wiki/Model-specific_register)寄存器，[MSR](https://en.wikipedia.org/wiki/Model-specific_register)寄存器是用于控制CPU运行、功能开关、调试、跟踪程序执行、监测CPU性能等方面的寄存器。
3. 触发系统调用后，它会在[MSR](https://en.wikipedia.org/wiki/Model-specific_register)中读取需要执行的函数然后执行。
4. 剩余流程和软件中断方式差不多。

![asm_call](/images/asm_call.png)

## 2.3 vDOS
Linux平台的用户使用系统调用的方式大多是通过[libc](https://www.gnu.org/software/libc/), 由于[libc](https://www.gnu.org/software/libc/)库要兼容BSD，SysV Windows等平台，所以每当Linux新增系统调用时，[libc](https://www.gnu.org/software/libc/)库都要间隔一段时间才会支持。并且有的用户升级Linux时并不会顺带升级[libc](https://www.gnu.org/software/libc/)，导致双方都带有沉重历史包袱。

后来Linux实现了快速系统调用vsyscall，内核提供.so通过动态链接直接map到进程空间里供用户使用，但是vsyscall有一个风险点——map 的起始地址固定（0xffffffffff600000)，有潜在的安全风险。

为了改善vsyscall的局限性，设计了[vDSO](https://en.wikipedia.org/wiki/VDSO)。但为了兼容vsyscall现在还保留着。

vDSO利用[ASLR](https://en.wikipedia.org/wiki/Address_space_layout_randomization)增强里安全性，随机地址。

可以看到Linux中的进程大多包含vDSO的动态库
```bash
➜  ~ ldd /bin/cat 
	linux-vdso.so.1 =>  (0x00007ffc03be0000)
	libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f52236dd000)
	/lib64/ld-linux-x86-64.so.2 (0x00007f5223aa7000)
```
但是并不存在实际的.so文件，vsyscall以及vDOS将系统调用变为函数调用，并把他们映射到用户空间，明显的提高了系统调用的性能。
Linux 2.6时，vsyscall就支持了clock_gettime, gettimeofday, time。[vdso.lds.S](https://github.com/torvalds/linux/blob/bbf5c979011a099af5dc76498918ed7df445635b/arch/x86/entry/vdso/vdso.lds.S)

![vdso](/images/vdso.jpeg)

看到这里的时候突然想到，刚参加工作的时候一位前辈和我说获取时间可以不使用系统调用，当时一脸懵逼，现在想想确实知道的太少。一些知识不是需要多高的智商才能学到，而是就摆在那，看了就不知道，不看就不知道。

# 3. 总结

系统调用是用户和硬件交互的媒介
1. 软中断实现是最初Linux实现系统调用方式，但现在还有使用的方式，例如golang在一些架构上系统调用还是使用软中断的方式，因为golang团队在做基准测试的时候发现，软中断方式和快速指令方式效率差不多。[runtime, syscall: use int $0x80 to invoke syscalls on android/386](https://go-review.googlesource.com/c/go/+/16996/)
2. 快速汇编指令，intel和amd专门用于系统调用的指令。
3. vsyscall和vDSO通过动态库的方式。
