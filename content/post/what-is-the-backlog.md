---
title: "backlog参数指的是什么？"
date: 2021-01-31T03:35:33+08:00
tags: 
- "Linux"
- "网络"
---

# 背景介绍
服务端编程中涉及网络交互的服务几乎都会监听一个端口，然后等待客户端的请求，然后交互。在Linux中监听的[系统调用](/what-is-system-call)是listen。glibc的接口如下：
```c++
int listen(int sockfd, int backlog);
```
其中参数sockfd为已经bind过端口和地址的fd，而backlog就是本文介绍的对象。

[BSD手册中](https://www.freebsd.org/cgi/man.cgi?query=listen&apropos=0&sektion=0&manpath=FreeBSD+12.2-RELEASE+and+Ports&arch=default&format=html)给它的定义是：
> "the maximum length the queue of pending connections may grow to.（由未处理连接构成的队列可能增长的最大长度）

这句话并没有解释backlog到底是处于SYN_RCVD状态的连接数还是处于ESTABLISHED状态的连接数。或者是处于两者皆可。

# Linux中的backlog是如何实现

下面我们从Linux实现来一步步揭开backlog的真面目。

首先listen涉及与网卡的交互，这种涉及与硬件交互的操作Linux都是通过系统调用来实现的，既然是系统调用那么目标就明确了，从listen的系统调用入口开始看。

listen函数的入口是[SYSCALL_DEFINE2(listen, int, fd, int, backlog)](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/socket.c#L1697)参数正如glibc的listen接口，第一个参数是listen用的socket，第二个参数是backlog。这个函数没有做任何事情只是调用了[__sys_listen](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/socket.c#L1676)，[__sys_listen](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/socket.c#L1676)就是具体的listen实现了：
1. 首先根据传入的fd调用[sockfd_lookup_light](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/socket.c#L494)找到对应的socket对象。
2. 将backlog和Linux配置中的```somaxconn(/proc/sys/net/core/somaxconn，默认128)```比较，如果比somaxconn大，就用somaxconn替换。
3. 调用struct socket结构里面ops的listen函数，拿TCP来说，创建socket时type=SOCK_STREAM，protocol=IPPROTO_TCP的ops是[inet_stream_ops](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/af_inet.c#L1018)，对应的listen函数是[inet_listen](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/af_inet.c#L196)。
4. [inet_listen](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/af_inet.c#L196)中判断一下socket状态还不是LISTEN的话，会调用[inet_csk_listen_start](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/inet_connection_sock.c#L911)进入监听状态。另外还会将backlog值赋给socket的sk_max_ack_backlog参数，后边虽然调用一直带着backlog参数，实际没用了，socket中已经有了。
5. [inet_csk_listen_start](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/inet_connection_sock.c#L911)中会创建一个新结构[struct inet_connection_sock](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/net/inet_connection_sock.h#L80)。这个结构体是维护连接状态的，里面包含了各种状态队列和超时以及拥塞控制的变量，其中我们关心的是icsk_accept_queue队列。内核会为每个socket维护两个队列，一个是三次握手完成处于ESTABLISHED状态的连接队列，另一个是三次握手进行中处于SYN_RCVD状态的连接队列，icsk_accept_queue就是前者。而用户调用accept实际是从icsk_accept_queue队列取出连接。
6. 初始化完之后，将 TCP 的状态设置为 TCP_LISTEN，再次调用 get_port 判断端口是否冲突。listen的逻辑就结束了。

上面已经介绍完listen的整个逻辑了，与咱们讨论的backlog有关的就是icsk_accept_queue队列。

当内核收到网卡收到数据而触发的硬中断之后，并且数据传递到四层时：
1. 如果是ipv4的tcp包会调用[tcp_v4_rcv](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/tcp_ipv4.c#L1915)，处理完tcp头以及其他一些信息之后就调用[tcp_v4_do_rcv](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/tcp_ipv4.c#L1655)，这个函数中分两种情况：处于ESTABLISHED状态的socket和未处于ESTABLISHED状态的socket。
2. 我们关心的是未处于ESTABLISHED状态的socket，会调用[tcp_rcv_state_process](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/tcp_input.c#L6303)，这个函数中，当socket状态是LISTEN时（因为客户端的连接包是发给listen fd的），会调用[struct inet_connection_sock](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/net/inet_connection_sock.h#L80)(listen系统调用时创建的)icsk_af_ops对象的conn_request接口，对应[tcp_conn_request](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/tcp_input.c#L6743)函数。
3. [tcp_conn_request](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/net/ipv4/tcp_input.c#L6743)会调用[inet_csk_reqsk_queue_is_full](https://github.com/torvalds/linux/blob/2c85ebc57b3e1817b6ce1a6b703928e113a90442/include/net/inet_connection_sock.h#L279)函数判断当前icsk_accept_queue长度是否超过sk_max_ack_backlog，如果超过就给客户端发一个RST包，客户端就当SYN包丢了，然后一直重试，第一次6s超时，然后24s，直到75s还没收到SYNACK就返回用户连接超时。

![](/images/backlog.png)

到目前为止得出结论，backlog是指**用户**未处理的连接数量，例如backlog为1，有三个客户端在同时连接，第一个连接可以正常三次握手，第二个连接SYN包到来时内核只会回一个RST包，客户端就当SYN包丢了不停重试，当用户调用accept获取了第一个连接之后，第二个内核才会给第二个连接回复SYNACK继续握手。

当然icsk_accept_queue最大长度不是绝对为backlog，而是backlog*模糊因子，下面是不同操作系统的backlog的设置。
![](/images/backlog_1.jpeg)
图片转自《UNIX网络编程卷一》
