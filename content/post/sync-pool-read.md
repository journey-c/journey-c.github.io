---
title: "sync.pool 源码阅读"
date: 2020-10-27T20:58:31+08:00
tags:
- 源码
- Golang
---

> 阅读项目代码的时候发现很多地方用到了golang的sync.pool，所以好奇golang的sync.pool底层实现是什么样的，有哪些优化。
本文是基于[go1.13.10](https://github.com/golang/go/tree/go1.13.10)做讲解。

在golang开发中[sync.pool](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/sync/pool.go#L44)是最常用的缓存池，当一个对象被频繁创建和释放时会用到，但一般不作为连接池使用因为[sync.pool](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/sync/pool.go#L44)中的对象随时会被释放掉，对象生命周期一般为两个GC间隔，且释放时机用户无感知。

# 1. 设计原理
[sync.pool](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/sync/pool.go#L44)的操纵都是线程安全的，每个P都有自己私有的存储空间和共享的存储空间。
- GET
获取对象时，一般先在当前P的私有空间获取，如果没有，再到当前P的共享空间获取，如果还没有就窃取其他P的共享空间，如果还没有就访问上次GC遗留的对象。上述操作完成后还没有获取到，则调用New函数创建对象。
- PUT
对象放回池子时，先判断当前P的私有空间是否为空，为空就放入，不为空就放入共享空间。

![](/images/design.png)

当GET/PUT非常频繁的时候，一般都只访问当前P的空间就可以完成操作。 GET/PUT不频繁时，即使访问到其他P的空间(有锁)，由于操作不频繁所以锁是可以接受的。

# 2. 数据结构

[Pool](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/sync/pool.go#L44)是sync.Pool的核心数据结构。先了解一下该结构体的内部字段。
```go
type Pool struct {
	noCopy noCopy

	local     unsafe.Pointer // local fixed-size per-P pool, actual type is [P]poolLocal
	localSize uintptr        // size of the local array

	victim     unsafe.Pointer // local from previous cycle
	victimSize uintptr        // size of victims array

	// New optionally specifies a function to generate
	// a value when Get would otherwise return nil.
	// It may not be changed concurrently with calls to Get.
	New func() interface{}
}
```
1. ```noCopy``` 是golang [防止拷贝](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/sync/cond.go#L89) 的机制。
2. ```local``` 和 ```localSize``` 是一个poolLocal的数组，```local```指向数组首地址，```localSize```为数组长度。```local```指向的数组poolLocal[i]表示id为i的P对应的存储对象。每个P都有一个存储对象。[P的id是从0到nprocs的](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/runtime/proc.go#L4029)。
3. ```victim``` 和 ```victimSize``` 也是一个poolLocal的数组。
4. ```New``` 是创建```Object```的函数。

在一次GC的间隙中，Get和Put的Object都是对local指向的数组操作的，如果local指向数组中没有，会再向victim指向数组中取，都没有才会New一个Object。
GC时回调用 [poolCleanup](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L233) 清理Pool，操作为：
1. 将victim指向数组的内容清空，并且将指针置空。
2. 将victim指向local指向的数组，并且将local指针置空。

所以Pool中的Object存活时间为两次GC间隔。

![](/images/design_1.png)

如上图所示，每个P都有一个[poolLocal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L65)用来存储对象。再来看下[poolLocal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L65)的内部字段。
```go
type poolLocal struct {
	poolLocalInternal

	// Prevents false sharing on widespread platforms with
	// 128 mod (cache line size) = 0 .
	pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```
1. 组合结构体[poolLocalInternal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L60)是实际的存储变量。
2. pad是防止[false sharing](https://en.wikipedia.org/wiki/False_sharing)的填充。

[poolLocal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L65)实际是一个组合结构体，pad只是防止[false sharing](https://en.wikipedia.org/wiki/False_sharing)做的填充，而实际用来存储的结构体是[poolLocalInternal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L60)，该结构体定义如下：
```go
// Local per-P Pool appendix.
type poolLocalInternal struct {
	// 当前调度器的私有资源
	private interface{} // Can be used only by the respective P.
	// 所有调度器的公有资源
	shared  poolChain   // Local P can pushHead/popHead; any P can popTail.
}
```
1. private是每个P的私有存储位置，通常只能容纳一个对象。
2. shared是所有调度器公有的存储位置。

[shared](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L62)是一个双向链表实现的队列[poolChain](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/poolqueue.go#L194)，而队列中每个元素[poolChainElt](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/poolqueue.go#L204)，又是一个静态环形队列[poolDequeue](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/poolqueue.go#L19)。环形队列的节点元素是[eface](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/poolqueue.go#L47)结构如下：
![](/images/design_2.png)

[shared](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L62)队列是一个生产消费模型的队列，```head```只用于生产，```tail```只用于消费：
1. GET操作通常是从队列```tail```端取对象。
2. PUT操作通常是将对象从```head```端放入。
![](/images/design_3.png)

其中环形队列[poolDequeue](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/poolqueue.go#L19)实现挺巧妙。是一个无锁、固定大小的单生产端多消费端的环形队列，单一producer可以在头部push和pop(可能和传统队列头部只能push的定义不同)，多consumer可以在尾部pop。
```go
type poolDequeue struct {
	headTail uint64

	vals []eface
}
```
1. headTail 表示下标，高32位表示头下标，低32位表示尾下标，用32位表示，溢出后会从0开始，满足循环队列的要求，
2. vals 队列数组，双向队列[poolChain](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/poolqueue.go#L194)第一个节点(poolDequeue)长度是8，第一个节点满之后就创建第二节点容量为8*2，每次扩容翻倍，直到到达限制dequeueLimit = (1 << 32) / 4 = (1 << 30)。

- 为什么vals长度必须是2的幂？

这是因为go的内存管理策略是将内存分为2的幂大小的链表，申请2的幂大小的内存可以有效减小分配内存的开销
- 为什么dequeueLimit是(1 << 32) / 4 = 1 << 30 ？

1. dequeueLimit 必须是2的幂(上边解释过)
2. head和tail都是32位，最大是1 << 31，如果都用的话，head和tail就是无符号整型，无符号整型使用的时候会有很多上溢的错误，这类错误是不容易检测的，所以相比之下还不如用31位有符号整型，有错就报出来。

# 3. 读写操作
## 3.1 GET
[Get](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L124)函数主要是从Pool中获取对象，这个对象可能是新创建的也可能之前PUT回Pool中的对象，即使Pool中只有一个元素也不要假设GET的到对象和PUT回的对象之间有什么联系。大概流程如下：
1. 调用[Pool.pin](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L195)将当前G固定到所在P，并且不允许抢占，获取到P的ID，根据ID在[local](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L47)指向[poolLocal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L65)数组中找到对应的[poolLocal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L65)。
> 1. [Pool.pin](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L195)函数首先禁止抢占，然后根据P的ID在local数组中查找一下有对用的pollLocal，有直接返回，没有的话就调用[Pool.pinSlow](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L209)
> 2. [Pool.pinSlow](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L209)打开抢占并且[allPools](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L265)加锁然后关闭抢占，这里如果不先打开抢占的话，其他goroutine如果之前获得锁了，但不能运行，当前goroutine在获取锁，就会死锁。然后再将G固定到当前P禁止抢占，获取P的ID。
> 3. 判断ID和len([]poolLocal)的关系，小于就返回[PID]poolLocal。
> 4. 如果此Pool的[]poolLocal是空的说明是一个新Pool，就把Pool加到allPools中，获得当前cpu的数量，创建一个cpu数量大小的[]poolLocal。
> 5. 返回对应poolLocal和P的ID。
2. 检查私有空间是否有缓存，有的话直接返回。
3. 没有的话，到当前P的[poolLocal](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L65)的共享空间中看一下，有的话直接返回。
4. 如果当前P的共享空间中也没有，就调用[Pool.getSlow](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L153)到其他P的共享空间中窃取一个，注意窃取操作就有锁了。

## 3.2 PUT
[Put](https://github.com/golang/go/blob/a57f07aac237d366630e85d080ef1ce0c34f0d09/src/sync/pool.go#L90)函数主要是将对象放回Pool。
1. 首先关闭竞争检测，然后会将当前goroutine固定到一个调度器(P)上，且不允许抢占
2. 从Pool的local中取出来当前goroutine固定到那个调度器(P)对应的poolLocal, 没有就新建
3. 先判断这个当前调度器(P)专属poolLocal，私有空间是不是空的，如果是把x放到私有空间，并把x置nil
4. 判断x是否为nil，如果不为空说明私有空间满了，就push到该调度器专属poolLocal的shared head
5. 允许抢占，开启竞争检测
