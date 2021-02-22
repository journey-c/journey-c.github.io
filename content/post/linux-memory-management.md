---
title: "Linux内存管理"
date: 2021-02-19T23:25:19+08:00
---

> 计算机的计算，一方面说的是进程、线程对于CPU的使用，另一方面是对于内存的管理。本文就是介绍Linux的内存管理。

在Linux中用户态是没有权限直接操作物理内存的，与硬件相关的交互都是通过系统调用由内核来完成操作的。Linux抽象出虚拟内存，用户态操作的只是虚拟内存，真正操作的物理内存由内核内存管理模块管理。本文通篇都在探索三个问题：
1. 虚拟地址空间是如何管理的
2. 物理地址空间是如何管理的
3. 虚拟地址空间和物理地址空间是如何映射的

上述三个问题得到解决之后，我们就可通过一个虚拟地址空间找到对应的物理地址空间。我们首先来看一下Linux虚拟地址空间的管理。

# 1. 虚拟地址空间的管理

是不是用户态使用虚拟内存，内核态直接使用物理内存呢？
> 不是的，内核态和用户态使用的都是虚拟内存。

使用虚拟地址一个核心的问题，需要记录虚拟地址到物理地址的映射，最简单的方式是虚拟地址与物理地址一一对应，这样4G内存光是维护映射关系就需要4G（扯淡）。所以需要其他有效的内存管理方案。通常有两种：分段、分页。下面我们来一起分析一下这两种管理机制以及在Linux中是如何应用的。

## 分段

![](/images/memory-management-x86-cpu.png)
8086升级到80386之后，段寄存器CS、DS、SS、ES从直接存放地址变成高位存放段选择子，低位做段描述符缓存器。由原来的直接使用内存地址变为现在的通过分段机制来使用内存地址。

那我们先来看一下内存管理中分段机制的原理。

![](/images/memory-management-segmented.png)

分段机制下虚拟地址由两部分组成，**段选择子**和**段内偏移量**。段选择子中的段号作为段表的索引，通过段号可以在段表找到对应段表项，每一项记录了一段空间：段基址、段的界限、特权级等。用段基址+段内偏移量就可以计算出对应的物理地址。

Linux中段表称为段描述符表，放在全局描述符表中，用[GDT_ENTRY_INIT](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/desc_defs.h#L23)函数来初始化表项[desc_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/desc_defs.h#L16)。

下面是Linux中[段选择子](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/segment.h#L171)和[段表](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/kernel/cpu/common.c#L115)的定义，看一下所有段表项初始化传入的参数中，段基址base都是0，这没有分段。事实上Linux中没有用到全部的分段功能，对于内存管理更倾向于分页机制。
```c
#define GDT_ENTRY_KERNEL32_CS		1
#define GDT_ENTRY_KERNEL_CS		2
#define GDT_ENTRY_KERNEL_DS		3

#define GDT_ENTRY_DEFAULT_USER32_CS	4
#define GDT_ENTRY_DEFAULT_USER_DS	5
#define GDT_ENTRY_DEFAULT_USER_CS	6
```
```c
DEFINE_PER_CPU_PAGE_ALIGNED(struct gdt_page, gdt_page) = { .gdt = {
#ifdef CONFIG_X86_64
	[GDT_ENTRY_KERNEL32_CS]		= GDT_ENTRY_INIT(0xc09b, 0, 0xfffff),
	[GDT_ENTRY_KERNEL_CS]		= GDT_ENTRY_INIT(0xa09b, 0, 0xfffff),
	[GDT_ENTRY_KERNEL_DS]		= GDT_ENTRY_INIT(0xc093, 0, 0xfffff),
	[GDT_ENTRY_DEFAULT_USER32_CS]	= GDT_ENTRY_INIT(0xc0fb, 0, 0xfffff),
	[GDT_ENTRY_DEFAULT_USER_DS]	= GDT_ENTRY_INIT(0xc0f3, 0, 0xfffff),
	[GDT_ENTRY_DEFAULT_USER_CS]	= GDT_ENTRY_INIT(0xa0fb, 0, 0xfffff),
#else
	[GDT_ENTRY_KERNEL_CS]		= GDT_ENTRY_INIT(0xc09a, 0, 0xfffff),
	[GDT_ENTRY_KERNEL_DS]		= GDT_ENTRY_INIT(0xc092, 0, 0xfffff),
	[GDT_ENTRY_DEFAULT_USER_CS]	= GDT_ENTRY_INIT(0xc0fa, 0, 0xfffff),
	[GDT_ENTRY_DEFAULT_USER_DS]	= GDT_ENTRY_INIT(0xc0f2, 0, 0xfffff),
	......
#endif
} };
EXPORT_PER_CPU_SYMBOL_GPL(gdt_page);
```

## 分页
分页机制和分段机制差不多，都是将物理地址分块。不同的是分段一般将内存大段大段的分割且每段大小一般不相同。而分页将物理内存分成一块块大小相同的页，一般大小为4KB。
![](/images/memory-management-pagination_0.png)
在分页机制下，虚拟地址有两部分组成(两部分不是严格的两段，比如页号就可以有多级页号)，**页号、页内偏移量**。通过页号找到对应页表项，页表项高位存了物理页号，低位存储了FLAGS。

例如页大小为4KB，只分一级，32位环境中虚拟地址为32位，$2^{32}/2^{12}=2^{20}$可以分1M个页，用20位可以表示页号，12位表示页内偏移。页表项大小为4B(32位)，那么页表大小就是$1M*4B=4MB$，因为每个进程都有自己独立的虚拟地址空间，有100个进程的话光维护页表就需要100MB的空间，这个对于内核来说有点太大了。
![](/images/memory-management-pagination_1.png)

Linux是如何解决页表太大的问题呢？
> 采用多级分页的策略才解决页表太大的问题。

32位环境中，一级分页和上边描述的一样，分成1M个4KB的页，由页表维护虚拟页号到物理页号的映射。内核在这次分页之后，又对页表进行分页。页表大小为4MB，我们在按照4KB一页进行分页，4KB包含页表项1K项。所以二级分页就是把页表1M的项按照1K项为一页分了1K页。
![](/images/memory-management-pagination_2.png)
二级分页后，虚拟地址就被分成三部分：页目录号、页表内偏移、页内偏移。通过虚拟地址查找物理地址时：
1. 通过虚拟地址前10位的页目录号找到对应页目录项，这个页目录项管理了1K个页表项。
2. 通过虚拟地址中10位的页表内偏移，从1K个页表项中定位到一个页表项。这个页表项里有物理页号和各种标志位。
3. 物理页号+虚拟地址中后12位的页内偏移得到对应物理地址。

这样用于维护分页机制的额外空间就是页表（4MB）+ 页表目录（4KB），这不是比一级分页更高了吗？
> 实际不是的:
> 1. 如果使用一级页表，那么每个进程都需要一个页表来维护虚拟地址空间，就是说100个进程需要额外400 MB的空间。
> 2. 如果使用二级页表，每个进程必须的是一个4KB的页目录表。当然并不是每个进程都是用全部4GB内存的。所以4MB的二级页表不会全部使用，用到多少地址就建多少个页表项。所以实际需要额外空间为4KB+使用的页表项数量*4KB
![](/images/memory-management-pagination_3.png)

当然64位的环境中，二级页表就不够了，使用的是四级页表，包括[全局页目录项 PGD（Page Global Directory）](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/pgtable_types.h#L286)、[上层页目录项 PUD（Page Upper Directory）](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/pgtable_types.h#L359)、[中间页目录项 PMD（Page Middle Directory）](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/pgtable_types.h#L385)和[页表项 PTE（Page Table Entry）](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/pgtable_64_types.h#L21)
![](/images/memory-management-pagination_4.png)

虽然多级分页解决了页表过大的问题，但是同时也增大了访问延时，由原来的一次访问内存，变为现在访问多次页表之后才能访问目的地址。

到目前为止，我们已经知道如何通过一个虚拟地址得到对应的物理地址。

# 2. 进程的虚拟地址空间
接下来我们再一起看一下进程内的虚拟地址空间是什么样的，Linux中没有进程线程的区别，用[struct task_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/sched.h#L640)表示任务。那么我们可以分析[struct task_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/sched.h#L640)中内存相关变量来分析进程的虚拟内存布局。

```c
struct task_struct {
	...
	struct mm_struct		*mm;
	...	
};
```

[struct task_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/sched.h#L640)里面[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)来管理内存。

首先，既然分析用户态的基本布局，当然要知道用户态和内核态的界限在哪，[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)里面的[task_size](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L405)变量表示用户态空间的大小。

使用系统调用[execve](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L2054)加载二进制文件的调用链是[do_execve](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1977) -> [do_execveat_common](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1855) -> [bprm_execve](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1775) -> [exec_binprm](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1727) -> [search_binary_handler](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1681) -> [linux_binfmt的load_binary接口](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/binfmt_elf.c#L100)。load_binary接口实际是[load_elf_binary](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/binfmt_elf.c#L820)。

[load_elf_binary](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/binfmt_elf.c#L820)调用[setup_new_exec](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1412)。这个函数中会将task的mm_struct成员变量task_size 设置为TASK_SIZE。

32位环境中内核定义如下，TASK_SIZE为0xC0000000，用户空间默认3GB，内核空间1GB。
```c
/*
 * User space process size: 3GB (default).
 */
#define IA32_PAGE_OFFSET	__PAGE_OFFSET
#define TASK_SIZE		__PAGE_OFFSET
#define TASK_SIZE_LOW		TASK_SIZE
#define TASK_SIZE_MAX		TASK_SIZE
#define DEFAULT_MAP_WINDOW	TASK_SIZE
#define STACK_TOP		TASK_SIZE
#define STACK_TOP_MAX		STACK_TOP
```
64位环境中虚拟地址只是用了48位，TASK_SIZE为 (1 << 47) 减去一页的大小为0x00007FFFFFFFF000。用户空间大概位128TB，内核空间也是128TB，且用户空间和内核空间之间留有空隙用于隔离。
```c
#define TASK_SIZE_MAX	((_AC(1,UL) << __VIRTUAL_MASK_SHIFT) - PAGE_SIZE)

#define DEFAULT_MAP_WINDOW	((1UL << 47) - PAGE_SIZE)

/* This decides where the kernel will search for a free chunk of vm
 * space during mmap's.
 */
#define IA32_PAGE_OFFSET	((current->personality & ADDR_LIMIT_3GB) ? \
					0xc0000000 : 0xFFFFe000)

#define TASK_SIZE_LOW		(test_thread_flag(TIF_ADDR32) ? \
					IA32_PAGE_OFFSET : DEFAULT_MAP_WINDOW)
#define TASK_SIZE		(test_thread_flag(TIF_ADDR32) ? \
					IA32_PAGE_OFFSET : TASK_SIZE_MAX)
#define TASK_SIZE_OF(child)	((test_tsk_thread_flag(child, TIF_ADDR32)) ? \
					IA32_PAGE_OFFSET : TASK_SIZE_MAX)
```
![](/images/memory-management-task-size.png)

## 用户态
了解了用户空间和内核空间分界之后，我们先来看下用户空间。用户态虚拟内存布局如下，32位和64位区域和布局差别不大。
![](/images/memory-management-user-mode-memory-layout.png)
这些空间里的内容是从哪填充来的呢？没错，是不是感觉和可执行文件的格式有点像。一个进程创建之后所有的内存空间都是复制父进程的，当父进程调用exec加载新的二进制时就会将二进制文件内容加载到进程内存各个模块中，但是不一定是立即加载，有些非必需字段是用时加载。
![](/images/memory-management-executable-file-format.png)
[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)结构体中如下参数定义了这些模块的属性和位置。

|类型|字段名|用途|
|---|---|---|
|struct vm_area_struct *|mmap|内存中每个区域对应一个mmap，这些区域用链表连接起来|
|struct rb_root|mm_rb|红黑树，用来辅助操作mmap|
|unsigned long|mmap_base|用于映射的内存起始位置|
|unsigned long|task_size|用户空间大小|
|unsigned long|total_vm|总共映射的页数|
|unsigned long|locked_vm|当内存吃紧，将个别页换到磁盘上，locaked_vm表示被锁定不能换出的页数|
|unsigned long|pinned_vm|不能换出也不能移动的页数|
|unsigned long|data_vm|存放数据页数|
|unsigned long|exec_vm|可执行文件占用的页数|
|unsigned long|stack_vm|栈占用的页数|
|unsigned long|start_code, end_code, start_data, end_data|代码段起始和结束位置，数据段起始和结束位置|
|unsigned long|start_brk, brk, start_stack|堆起始结束位置，栈起始位置(栈结束位置在SP寄存器中)|
|unsigned long|arg_start, arg_end, env_start, env_end|参数列表起始和结束位置，环境变量起始和结束位置|

函数[load_elf_binary](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/binfmt_elf.c#L820)负责加载二进制，并且根据可执行文件内容初始化各个区域。
1. 调用[setup_new_exec](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1412)设置[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)的mm_base参数（mmap内存映射区域）,并且设置task_size的值。
2. 调用[setup_arg_pages](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L741)设置栈的[struct vm_area_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L305)结构，并设置参数列表起始位置arg_start的值，arg_start指向栈低start_stack的位置。
3. 调用[elf_map](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/binfmt_elf.c#L360)将可执行文件中的代码段映射到内存空间。
4. 调用[set_brk](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/binfmt_elf.c#L110)设置堆空间的[struct vm_area_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L305)，并且初始化start_brk=brk（堆为空）。
5. 如果有动态库，则调用[load_elf_interp](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/binfmt_elf.c#L588)映射到内存映射区域。
6. 给start_code, end_code, start_data, end_data赋值。

进程的用户态布局就变成下面这样。
![](/images/memory-management-user-mode-memory-layout_1.png)

内存区域映射完之后，存在一下情况区域会发生变化：
1. 用户调用malloc/free申请堆空间，小内存操作调用brk移动堆结束指针，大内存操作调用mmap。
2. 创建临时变量或函数调用导致栈指针移动时对应栈区域也会移动。

这里简单看下堆内存操作brk的过程，mmap后边会讲解。
1. 入口在[SYSCALL_DEFINE1(brk, unsigned long, brk)](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L190)。参数brk就是新堆顶的位置。
2. 将参数堆顶位置brk和进程旧堆顶位置brk关于页对齐，如果对齐后两者相同说明变化量很小可以在同一页里解决。将mm_struct的brk指向新的brk即可。
3. 如果两者对齐后不相同，说明操作跨页了，如果新brk小于旧的brk说明是释放内存，就调用[__do_munmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L2806)将多余的页去掉映射。
4. 如果新brk大于旧brk说明是申请内存，就调用[find_vma](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L2300)在红黑树中找到下一个[struct vm_area_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L305)的位置，看中间是否还能分配一个完整的页，分配不了就报错。如果能就更新各参数分配。

## 内核态
内核态的虚拟地址空间和某个进程没关系，所有进程共享同一个内核态虚拟地址空间。并且此时讨论的还是虚拟地址空间。前面分析用户态和内核态分界的时候讲了32位内核态是1GB，64位内核态是128TB。因为空间的数量级就差很大，可想而知布局也会有一定差别，毕竟32位太小了。我们先来分析一下32位内核态的布局。
![](/images/memory-management-kernel-mode-memory-layout.png)

1. 前896M为直接映射区，这部分地址连续，虚拟地址与物理地址映射关系较为简单，内核用了两个宏定义来转换地址[#define __va(x)](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/page.h#L59)，[#define __pa(x)](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/page.h#L42)实际转换规则就是虚拟地址-PAGE_OFFSET(前面讲过用户空和内核空间分界)得到物理地址，物理地址+PAGE_OFFSET得到虚拟地址。直接映射区前1M空间开机处于实模式时会使用，内核代码从1M开始加载，然后就是全局变量、BSS等，另外内存管理的页表以及进程的内核栈都会放在这个区域。
2. 接下来就是8M的空洞，用于捕捉内存越界。其他空洞也是这个原因。
3. VMALLOC_START到VMALLOC_END成为动态映射空间，类似进程的堆，内核使用[vmalloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/vmalloc.c#L2632)进行动态申请内存的区域。
4. PKMAP_BASE到FIXADDR_START是持久映射空间，通常为4M，内核使用[alloc_pages](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/gfp.h#L555)获得[struct page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L68)结构，然后调用[kmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/highmem.h#L48)将其映射到这个区域。
5. FIXADDR_START到FIXADDR_TOP为固定映射区域，留作特定用途。

64位的内核态布局就较为简单了，毕竟128TB太大不需要扣内存。
![](/images/memory-management-kernel-mode-memory-layout-64.png)
1. 内核空间从0xffff800000000000开始，之后有8T空洞。
2. 0xFFFF880000000000到0xFFFFC80000000000是直接映射区，同32位。
3. 0xFFFFC90000000000到0xFFFFE90000000000是动态映射区，同32位。
4. 然后就是存放物理页表，同32位持久映射区域。

# 3. 物理地址空间的管理
讲完了虚拟地址空间的管理，现在再来看一下Linux是如何管理物理内存的。

传统的x86架构的工作模式中，多处理器与一个集中存储器相连时，所有CPU都要通过总线去访问内存。也就是对称多处理器模式[SMP（Symmetric multiprocessing）](https://en.wikipedia.org/wiki/Symmetric_multiprocessing)。
![](/images/memory-management-symmetric-multiprocessing.png)
由于所有的内存访问都要经过总线，所以总线会成为瓶颈。

为了提高性能和扩展性，诞生了一种更高级的模式，非一致性内存访问[NUMA（Non-uniform memory access）](https://en.wikipedia.org/wiki/Non-uniform_memory_access)。这种模式下每个CPU有自己本地的内存，当本地内存不足时才会访问其他NUMA节点的内存。这样就提高了访问的效率。
![](/images/memory-management-physical-memory.png)

值得注意的一点就是Mysql对NUMA支持不友好，NUMA在默认在本地CPU上分配内存，会导致CPU节点之间内存分配不均衡，当某个CPU节点的内存不足会使用Swap而不是直接从远程节点分配内存。经常内存还有耗尽，Mysql就已经使用Swap照成抖动，这就是"Swap Insanity"。所以单机部署Mysql的时候最好将NUMA关掉。

## 节点
接下来我们就看一下当前主流的模式NUMA，NUMA模式中内存分节点，每个CPU有本地内存，内核中用[typedef struct pglist_data pg_data_t](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mmzone.h#L726)表示节点。我们来看一下这个结构体重点的变量。
```c
typedef struct pglist_data {
	struct zone node_zones[MAX_NR_ZONES];
	struct zonelist node_zonelists[MAX_ZONELISTS];
	int nr_zones; /* number of populated zones in this node */
#ifdef CONFIG_FLAT_NODE_MEM_MAP	/* means !SPARSEMEM */
	struct page *node_mem_map;
#ifdef CONFIG_PAGE_EXTENSION
	...
	unsigned long node_start_pfn;
	unsigned long node_present_pages; /* total number of physical pages */
	unsigned long node_spanned_pages; /* total size of physical page
					     range, including holes */
	int node_id;
	...
} pg_data_t;
```
1. 节点ID，node_id。
2. node_mem_map 就是这个节点的 struct page 数组，用于描述这个节点里面的所有的页。
3. node_start_pfn 是这个节点的起始页号。
4. node_spanned_pages 是这个节点中包含不连续的物理内存地址的页面数。
5. node_present_pages 是真正可用的物理页面的数目。
6. 节点内再将页分成区，存放在node_zones数组中。大小是MAX_NR_ZONES。
7. nr_zones表示节点的区域数量。
8. node_zonelists是备用节点和它的内存区域的情况。当本地内存不足时会使用到。

区域的类型如下：
```c
enum zone_type {
#ifdef CONFIG_ZONE_DMA
	ZONE_DMA,
#endif
#ifdef CONFIG_ZONE_DMA32
	ZONE_DMA32,
#endif
	ZONE_NORMAL,
#ifdef CONFIG_HIGHMEM
	ZONE_HIGHMEM,
#endif
	ZONE_MOVABLE,
#ifdef CONFIG_ZONE_DEVICE
	ZONE_DEVICE,
#endif
	__MAX_NR_ZONES
};
```
1. ZONE_DMA直接内存读取区域，DMA是一种机制，要把外设的数据读入内存或把内存的数据传送到外设，原来都要通过 CPU 控制完成，但是这会占用 CPU，影响 CPU 处理其他事情，所以有了 DMA 模式。CPU 只需向 DMA 控制器下达指令，让 DMA 控制器来处理数据的传送，数据传送完毕再把信息反馈给 CPU，这样就可以解放 CPU。对于64位系统有两个DMA区域ZONE_DMA、ZONE_DMA32，后者只能被32位设备访问。
2. ZONE_NORMAL直接映射区，内核虚拟地址空间讲过，就是地址加上一个常量与虚拟地址空间映射。
3. ZONE_HIGHMEM高端内存区，64位系统是不需要的。
4. ZONE_MOVABLE可移动区，通过将内存划分为可移动区和不可移动区来避免碎片。
5. ZONE_DEVICE为支持热插拔设备而分配的Non Volatile Memory非易失性内存

## 区
内核将内存分区的目的是形成不同内存池，从而根据用途进行分配。内核使用[struct zone](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mmzone.h#L448)表示区。区就是本节点一个个页集合了。我们再来看一下这个结构体。
```c
struct zone {
	...
	struct pglist_data	*zone_pgdat;
	struct per_cpu_pageset __percpu *pageset;
	...
	unsigned long		zone_start_pfn;
	atomic_long_t		managed_pages;
	unsigned long		spanned_pages;
	unsigned long		present_pages;
	const char		*name;
	...
	struct free_area	free_area[MAX_ORDER];
	unsigned long		flags;
	spinlock_t		lock;
	...
} ____cacheline_internodealigned_in_smp;
```
1. zone_start_pfn表示这个区中第一页。
2. spanned_pages表示和节点中的node_spanned_pages变量类似，都是不连续物理页数，就是终止页减去起始页(中间可能有空洞，但是不管)。
3. present_pages实际物理页数量。
4. managed_pages被伙伴系统管理的所有的 page 数目。
5. pageset用于区分冷热页，前面将分段机制时说过80386架构CS、DS等段寄存器由单纯表示段地址升级为段选择子和段描述符缓存器。就是说有些经常被访问的页会被缓存在寄存器中，被缓存的就是热页，这个变量就是用于区分冷热页。
6. free_area空闲页。

## 页
然后就到了最基本的内存单元——页，内核使用[struct page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L68)表示物理页。结构体中有很多union，用于不同模式时的表示。主要有两种模式，1. 整页分配使用伙伴系统、2. 小内存分配使用slab allocator技术。

## 页的分配
页的分配有两种情况：
1. 按页分配
2. Slab分配（通常分配大小小于一页）

### 按页分配

使用伙伴系统分配，[struct zone](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mmzone.h#L448)中的free_area数组每个元素都是一个链表首地址，每条链表有1、2、4、8、16、32、64、128、256、512 和 1024 个连续页。也就是说最多可以分配4MB的连续内存，每个页块的地址物理页地址是页块大小的整数倍。
![](/images/memory-management-free-area.png)
分配使用函数[alloc_pages](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/gfp.h#L545)，该函数返回连续物理页的第一页的[struct page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L68)的地址。
1. [alloc_pages](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/gfp.h#L545)调用[alloc_pages_current](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mempolicy.c#L2256)。
2. [alloc_pages_current](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mempolicy.c#L2256)中根据参数gfp判断分配什么类型的页，GFP_USER用户空间页，GFP_KERNEL内核空间页，GFP_HIGHMEM高端内存页。参数order表示分配$2^{order}$个页。之后调用[__alloc_pages_nodemask](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/page_alloc.c#L4917)。
3. [__alloc_pages_nodemask](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/page_alloc.c#L4917)是伙伴系统的核心方法，大概逻辑就是先看当前区空闲页是否足够，不够就看备用区，遍历每个区时，比如要分配128个页，就会从128个页的块往上找，例如128没有，256有，就将256分割称128和128，一个用于分配，另一个放入128页为一块的链表中。

释放页使用[free_pages](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/page_alloc.c#L5020)，参数addr和order分别为page地址和要是释放的页数，释放页数为$2^{order}$。

### Slab分配
内核以及用户空间几乎很少用到按页分配的情况，普遍使用都是像malloc那样小段内存申请，并且操作十分频繁。这种频繁的操作通常会使用空闲链表，空闲链表缓存被释放的结构，下次分配是直接从链表抓取而不是申请。

内核中，空闲链表面临的主要问题是不能全局控制，当可用内存紧缺时，内核无法通知每个空闲链表收缩从而释放一些内存。事实上内核根本不知道存在哪些空闲链表。为了弥补这一缺陷，Linux内核提供了Slab层。Slab分配器来充当通用数据结构缓存层的角色，以感知所有缓存链表状态。[^1]

![](/images/memory-management-slab-allocator.png)

Slab分配模式中：
- 每个结构体对应一个高速缓存，由[kmem_cache_create](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slab.h#L147)函数创建，由[kmem_cache_destroy](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slab.h#L155)函数销毁。例如进程线程的结构体[struct task_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/sched.h#L640)对应高速缓存为[task_struct_cachep](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/kernel/fork.c#L166)，进程虚拟内存管理结构体[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)对应高速缓存为[mm_cachep](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/kernel/fork.c#L342)，每个高速缓存都使用[struct kmem_cache](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slub_def.h#L83)表示。这里的[struct kmem_cache](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slub_def.h#L83)是```include/linux/slub_def.h```下的，高速缓存中有多个slab。
> **内核最开始只有slab，后来开发者对slab逐渐完善，就出现了slob和slub。slob针对嵌入式等内存有限的机器，slub针对large NUMA系统的大型机。**

- 每个slab里面存放了若干个连续物理页用于分配，物理页按照结构体大小分割。工程师通过[kmem_cache_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slab.h#L390)申请结构体，通过[kmem_cache_free](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slab.h#L391)释放结构体(放回)。

先分析一下高速缓存[struct kmem_cache](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slub_def.h#L83)。
![](/images/memory-management-kmem-cache.png)
1. cpu_slab 是每个CPU本地缓存。
	- void **freelist 空闲对象链表
	- struct page *page 所有连续的物理页
	- struct page *partial 部分分配的物理页，这是备用的。
2. list 是高速缓存所在链表。
3. node[MAX_NUMNODES] 是该高速缓存所有的slab的数组，每个slab都有一个状态(1.满的，2.空的，3.半满)，本地缓存不够时根据这个状态去找其他的slab。另外还用链表维护着这三个状态的slab。
	- struct list_head slabs_partial 存放半满的slab
	- struct list_head slabs_full 存放已满的slab
	- struct list_head slabs_free 存放空的slab

下面我们根据调用系统调用[execve](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L2054)加载二进制文件的例子来看一下NUMA环境中Slab分配内存的完整过程。既然要加载二进制文件，那么进程结构体[struct task_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/sched.h#L640)中内存管理变量[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)当然要申请了。

调用链为[execve](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L2054)->[do_execve](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1977) -> [do_execveat_common](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1855) -> [alloc_bprm](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L1484) -> [bprm_mm_init](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/exec.c#L363) -> [mm_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/kernel/fork.c#L1059) -> [allocate_mm](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/kernel/fork.c#L669) -> [kmem_cache_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slab.h#L390)

到这里可以看到高速缓存申请的接口[kmem_cache_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slab.h#L390)，其中参数[struct kmem_cache](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/slub_def.h#L83)是[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)对应的高速缓存。再看一下这个函数做了哪些事情：
1. 调用[slab_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slub.c#L2896)，紧接着调用[slab_alloc_node](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slub.c#L2807)。
2. [slab_alloc_node](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slub.c#L2807)中首先在CPU本地缓存cpu_slab中分配，这就是注释中说的快速通道，分配到了直接返回，否则就调用[__slab_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slub.c#L2660)去其他slab中分配，这就是普通通道。
3. [__slab_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slub.c#L2660)中首先再尝试从本地缓存cpu_slab中分配，没有的话就跳到[new_slab](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slub.c#L2732)先考虑从本地缓存cpu_slab备用物理页partial中分配，再没有的话就调用[new_slab_objects](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slub.c#L2564)去其他slab中分配了。如果在没有就只能在申请物理页了。

到现在已经说完slab分配对象的逻辑了，但是还有一个问题，就是空闲缓存的回收，由于有了slab层内核已经可以感知所有空闲链表的状态了，所以回收问题是可以解决的。初始化时内核就会注册回收任务，每隔两秒进行一次检查，检查是否需要收缩空闲链表。调用链是[cpucache_init](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slab.c#L1311) -> [slab_online_cpu](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slab.c#L1077) -> [start_cpu_timer](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slab.c#L510) 将[cache_reap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/slab.c#L3951)注册为定时回调函数。

## 页换出
不管32位还是64位操作系统，不一定非得按照操作系统要求装内存条，例如32位最大4G虚拟地址空间，但是用户就买了2G怎么办？超过2G的虚拟地址空间不用了吗？不会的，现在几乎所有操作系统都是支持SWAP，就是将不活跃的物理页暂时缓存到磁盘上。

一般页换出有两种方式：
1. 主动（当申请内存时，内存紧张就考虑将部分页缓存到磁盘）
2. 被动（Linux 内核线程[kswapd](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/vmscan.c#L3862)定时检查是否需要换出部分页）
	- 调用链为[balance_pgdat](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/vmscan.c#L3542) -> [kswapd_shrink_node](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/vmscan.c#L3494) -> [shrink_node](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/vmscan.c#L2667) -> [shrink_node_memcgs](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/vmscan.c#L2610)
	- [shrink_node_memcgs](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/vmscan.c#L2610)就是处理页换出的函数了，里面有个LRU表，根据最近最少未使用的原则换出。

# 4. 内存映射
上边讲完了虚拟地址空间和物理地址空间是如何管理的，还剩下最后一个问题，这俩是怎么映射的？其实虚拟地址不止可以和物理内存映射，还可以和文件等映射。物理内存只是一种特殊的情况。

## 用户态映射
首先来看一下用户态映射方式。
![](/images/memory-management-user-mode-memory-mapping.png)
前边说堆的时候，malloc函数只讲了小内存brk的方式，当申请内存较大时会使用mmap（不是系统调用那个），对于堆来说就是将虚拟地址映射到物理地址。另外如果想将文件映射到内存也可以调用[mmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/kernel/sys_x86_64.c#L89)。

我们先来分析一下[mmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/kernel/sys_x86_64.c#L89)。
1. 调用[ksys_mmap_pgoff](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L1591)参数有fd，通过fd找到对应[struct file](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/fs.h#L916)。接下来调用[vm_mmap_pgoff](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/util.c#L494) -> [do_mmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L1404)。
2. [do_mmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L1404)中：
	1. 首先调用[get_unmapped_area](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L2256)在进程地址空间里找到一个没映射的区域(那棵红黑树)。
	2. 然后调用[mmap_region](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mmap.c#L1726)将文件映射到这个区域，并且调用[call_mmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/fs.h#L1906)执行file->f_op->mmap接口把这个区域的[struct vm_area_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L305)结构的内存操作接口换成那个文件的操作函数，也就是说对这段虚拟内存读写，就相当于执行该文件的读写函数。如果是ext4文件系统对应的mmap接口就是[ext4_file_mmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/ext4/file.c#L748)。[ext4_file_mmap](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/ext4/file.c#L748)中执行内存操作替换为文件操作vma->vm_ops = &ext4_file_vm_ops;
	3. 然后将[struct vm_area_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L305)挂到进程的[struct mm_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L388)上。
3. 现在文件已经和虚拟内存地址有映射了。还没有与物理内存产生关系，而物理内存的映射是用到的时候才映射。

### 缺页
访问某个虚拟地址时，如果没有对应的物理页就会触发缺页中断[handle_page_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/mm/fault.c#L1416)这里会判断是内核态缺页还是用户态缺页，我们先来看用户态的，会调用[do_user_addr_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/mm/fault.c#L1213)。这个函数中：
1. 找到缺页区域对应的[struct vm_area_struct](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm_types.h#L305)。
2. 然后调用[handle_mm_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4579)->[__handle_mm_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4423)。
3. [__handle_mm_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4423)中首先会创建前面一直提的页表，然后调用[handle_pte_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4330)。
4. [handle_pte_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4330)中有三种情况：
	1. PTE表为空，说明是缺页(新的)
		- 如果映射到物理内存就调用[do_anonymous_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L3469)。
		- 如果映射到文件就调用[do_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4098)。
	2. PTE表不为空，说明页表创建过了，是被换出到磁盘的就调用[do_swap_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L3241)。

一个个分析，首先看映射到物理页的函数[do_anonymous_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L3469)：
1. 调用[pte_alloc](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/mm.h#L2231)分配一个页表。
2. 页表有了，就要申请一个物理页放到页表项里了，调用链是[alloc_zeroed_user_highpage_movable](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/highmem.h#L274) -> [__alloc_zeroed_user_highpage](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/highmem.h#L251) -> [alloc_page_vma](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/gfp.h#L565) -> [alloc_pages_vma](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/mempolicy.c#L2173) -> [__alloc_pages_nodemask](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/page_alloc.c#L4917)。又看到熟悉的函数了[__alloc_pages_nodemask](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/page_alloc.c#L4917)就是前边说过的伙伴系统核心函数。
3. 调用mk_pte创建一个页表项并把物理页放进去，最后调用set_pte_at将页表项放入页表。至此页表里面有对应物理页了，虚拟地址就有映射了。

再来看下映射到文件的函数[do_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4098):
1. [do_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L4098)也有几种不同情况但最终都会调到[__do_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L3585)。
2. [__do_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L3585)中会调用vma->vm_ops->fault接口，之前文件映射是说过在缺页之前已经将内存操作接口换成文件操作接口了，所以如果是ext4文件系统，这里的vm_ops就应该是ext4_file_vm_ops，也就是调用了[ext4_filemap_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/ext4/inode.c#L6186)。紧接着调用[filemap_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/filemap.c#L2709)。
3. [filemap_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/filemap.c#L2709)首先调用[find_get_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/pagemap.h#L332)查找一下物理内存里事先有没有缓存好的，如果找到了就调用[do_async_mmap_readahead](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/filemap.c#L2662)从文件中预读一些数据到内存。没有的话就调用[pagecache_get_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/filemap.c#L1787)分配一个物理页并且把物理页加到LRU表里，然后调用struct address_space *mapping->a_ops->readpage接口将文件内容缓存到物理页中。ext4文件系统readpage接口对应[ext4_readpage](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/ext4/inode.c#L3228)，这个函数又调用到[ext4_readpage_inline](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/ext4/inline.c#L498) -> [ext4_read_inline_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/ext4/inline.c#L464)。
4. [ext4_read_inline_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/fs/ext4/inline.c#L464)中首先调用[kmap_atomic](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/linux/highmem.h#L92)映射到内核的虚拟地址空间得到虚拟地址kaddr，本来的目的是将物理内存映射到用户虚拟地址空间，但是从文件读取内容缓存到物理内存又不能用物理地址(除了内存管理模块其他操作都得是虚拟地址)，所以这里kaddr只是临时虚拟地址，读取完再把kaddr取消就行。

最后一种是交换空间类型的，函数[do_swap_page](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/memory.c#L3241)，swap类型的和映射到文件的差不多，都是需要从把磁盘文件映射到内存。
1. 首先调用[lookup_swap_cache](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/swap_state.c#L369)查看swap文件在内存有没有缓存页，有就直接用，没有就调用[swapin_readahead](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/swap_state.c#L891)将swap文件读到内存页中缓存，再调用mk_pte创建页表项，调用set_pte_at将页表项放入页表。
2. 读swap文件过程和上一步映射到文件的差不多。
3. 调用[swap_free](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/swapfile.c#L1357)释放掉swap文件。

处理完缺页之后，物理页有内容、进程空间有页表，接下来就可以通过虚拟地址找到物理地址了。

为了加快映射速度，我们引进了[TLB](https://en.wikipedia.org/wiki/Translation_lookaside_buffer)专门来做地址映射的硬件，缓存了部分页表。查询时先查快表TLB查到了直接用物理内存，查不到再到内存访问页表。

## 内核态映射
首先内核页表和用户态页表不同，内核页表在初始化时就创建了。内核[初始化时](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/mm/init-mm.c#L31)将swapper_pg_dir赋值给顶级目录pgd。[swapper_pg_dir](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/pgtable_64.h#L29)指向顶级目录init_top_pgt。

系统初始化函数[setup_arch](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/kernel/setup.c#L771)调用[load_cr3(swapper_pg_dir)](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/include/asm/processor.h#L255)刷新TLB说明页表已经构建完了。

实际初始化在[arch/x86/kernel/head_64.S](https://github.com/torvalds/linux/blob/v5.10/arch/x86/kernel/head_64.S)中。
```c
#if defined(CONFIG_XEN_PV) || defined(CONFIG_PVH)
SYM_DATA_START_PTI_ALIGNED(init_top_pgt)
	.quad   level3_ident_pgt - __START_KERNEL_map + _KERNPG_TABLE_NOENC
	.org    init_top_pgt + L4_PAGE_OFFSET*8, 0
	.quad   level3_ident_pgt - __START_KERNEL_map + _KERNPG_TABLE_NOENC
	.org    init_top_pgt + L4_START_KERNEL*8, 0
	/* (2^48-(2*1024*1024*1024))/(2^39) = 511 */
	.quad   level3_kernel_pgt - __START_KERNEL_map + _PAGE_TABLE_NOENC
	.fill	PTI_USER_PGD_FILL,8,0
SYM_DATA_END(init_top_pgt)

SYM_DATA_START_PAGE_ALIGNED(level3_ident_pgt)
	.quad	level2_ident_pgt - __START_KERNEL_map + _KERNPG_TABLE_NOENC
	.fill	511, 8, 0
SYM_DATA_END(level3_ident_pgt)
SYM_DATA_START_PAGE_ALIGNED(level2_ident_pgt)
	/*
	 * Since I easily can, map the first 1G.
	 * Don't set NX because code runs from these pages.
	 *
	 * Note: This sets _PAGE_GLOBAL despite whether
	 * the CPU supports it or it is enabled.  But,
	 * the CPU should ignore the bit.
	 */
	PMDS(0, __PAGE_KERNEL_IDENT_LARGE_EXEC, PTRS_PER_PMD)
SYM_DATA_END(level2_ident_pgt)
#else
SYM_DATA_START_PTI_ALIGNED(init_top_pgt)
	.fill	512,8,0
	.fill	PTI_USER_PGD_FILL,8,0
SYM_DATA_END(init_top_pgt)
#endif
```

## 缺页
内核空间缺页同样会调用[handle_page_fault](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/arch/x86/mm/fault.c#L1416)。

# 5. 总结
1. Linux虚拟地址空间采用分页机制，多级页表来减小页表占用空间。其原因就是越往后的页表项没用到的可以不用建。
2. 物理地址管理:
	1. 内核管理单元管理。主流采用NUMA模型，每个CPU有本地内存(节点)，本地内存根绝用途再分区，每个区里就是物理页集合。
	2. 物理页申请时:
		1. 大内存按页分配通过伙伴系统
		2. 小内存通过slab分配器。那个结构体对应一个高速缓存，结构体申请释放都通过高速缓存，高速缓存里有很多slab，每个CPU又一个本地slab。slab里面就是很多待分配的结构体了。
	3. 物理内存紧张时会换出部分页面到磁盘上，也就是swap文件。
3. 地址映射
	1. 虚拟地址映射到物理地址
	2. 虚拟地址映射到文件	
	3. 用到虚拟地址是会检查是否有对应物理地址没有的话，就缺页。
		1. 虚拟地址映射到物理地址的缺页——分配物理页。
		2. 虚拟地址映射到文件的缺页——分配物理页，加载部分数据到物理页。
		2. 物理地址映射到磁盘swap文件——分配物理页，将swap文件加载进来。

[^1]: [Linux内核设计与实现第三版](https://book.douban.com/subject/6097773/)
