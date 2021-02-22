---
title: "长连接平滑重启"
date: 2020-10-21T22:48:31+08:00
tags:
- 网络
- Golang
---


> 最近小编一直在做长连接相关的事情，最大的感触就是发版太痛苦，一个个踢掉连接然后发版，导致发版时长过长，操作繁琐。所以在想能不能实现优雅重启, 发版时客户端无感知。


# 1.难点

- 如何做到不中断接收连接

- 如何做到已有连接不中断

# 2.解决

## 2.1 如何做到不中断接受连接

以下是linux源码中bind的实现(linux-1.0)
```c
// linux-1.0/net/socket.c 536
static int
sock_bind(int fd, struct sockaddr *umyaddr, int addrlen)
{
  struct socket *sock;
  int i;

  DPRINTF((net_debug, "NET: sock_bind: fd = %d\n", fd));
  if (fd < 0 || fd >= NR_OPEN || current->filp[fd] == NULL)
								return(-EBADF);
  //获取fd对应的socket结构
  if (!(sock = sockfd_lookup(fd, NULL))) return(-ENOTSOCK);
  // 转调用bind指向的函数，下层函数(inet_bind)
  if ((i = sock->ops->bind(sock, umyaddr, addrlen)) < 0) {
	DPRINTF((net_debug, "NET: sock_bind: bind failed\n"));
	return(i);
  }
  return(0);
}

// linux-1.0/net/inet/sock.c 1012
static int
inet_bind(struct socket *sock, struct sockaddr *uaddr,
	       int addr_len)
{
  ...
outside_loop:
  for(sk2 = sk->prot->sock_array[snum & (SOCK_ARRAY_SIZE -1)];
					sk2 != NULL; sk2 = sk2->next) {
#if 	1	/* should be below! */
	if (sk2->num != snum) continue;
/*	if (sk2->saddr != sk->saddr) continue; */
#endif
	if (sk2->dead) {
		destroy_sock(sk2);
		goto outside_loop;
	}
	if (!sk->reuse) {
		sti();
		return(-EADDRINUSE);
	}
	if (sk2->num != snum) continue;		/* more than one */
	if (sk2->saddr != sk->saddr) continue;	/* socket per slot ! -FB */
	if (!sk2->reuse) {
		sti();
		return(-EADDRINUSE);
	}
  }
  ... 
}

```

- sock_array是一个链式哈希表，保存着各端口号的sock结构  
- 通过源码可以看到，bind的时候会检测要绑定的地址和端口是否合法以及已被绑定, 如果发版时另一个进程和旧进程没有关系，则bind会返回错误Address already in use  
- 若旧进程fork出新进程，新进程和旧进程为父子关系，新进程继承旧进程的文件表，本身"本进程"就已经监听这个端口了，则不会出现上面的问题

## 2.2 如何做到已有连接不中断

- 新进程继承旧进程的用于连接的fd，并且继续维持与客户端的心跳

  linux提供了unix域套接字可用于socket的传输, 新进程起来后通过unix socket通信继承旧进程所维护的连接

```c
#include <sys/types.h>
#include <sys/socket.h>

ssize_t sendmsg(int sockfd, const struct msghdr *msg, int flags);
ssize_t recvmsg(int sockfd, struct msghdr *msg, int flags);
```

发送端调用sendmsg发送文件描述符，接收端调用revmsg接收文件描述符。  

两进程共享同一打开文件表，这与fork之后的父子进程共享打开文件表的情况完全相同。  

***由此解决了文章开头提出的两个问题***


# 3. Demo实现

- 进程每次启动时必须check有无继承socket(尝试连接本地的unix server，如果连接失败，说明是第一次启动，否则可能有继承的socket)，如果有，就将socket加入到自己的连接池中, 并初始化连接状态

- 旧进程监听USR2信号(通知进程需要重启，使用信号、http接口等都可)，监听后动作:
    1) 监听Unix socket, 等待新进程初始化完成，发来开始继承连接的请求
    2) 使用旧进程启动的命令fork一个子进程(发布到线上的新二进制)。
    3) accept到新进程的请求，关闭旧进程listener(保证旧进程不会再接收新请求，同时所有connector不在进行I/O操作。
    4) 旧进程将现有连接的socket，以及连接状态(读写buffer，connect session)通过 unix socket发送到新进程。
    5) 最后旧进程给新进程发送发送完毕信号，随后退出

- 以下是简单实现的demo, demo中实现较为简单，只实现了文件描述符的传递，没有实现各连接状态的传递。

```go
// server.go

package main

import (
	"flag"
	"fmt"
	"golang.org/x/sys/unix"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

var (
	workSpace string

	logger *log.Logger

	writeTimeout = time.Second * 5
	readTimeout  = time.Second * 5

	signalChan = make(chan os.Signal)

	connFiles sync.Map

	serverListener net.Listener

	isUpdate = false
)

func init() {
	flag.StringVar(&workSpace, "w", ".", "Usage:\n ./server -w=workspace")
	flag.Parse()

	file, err := os.OpenFile(filepath.Join(workSpace, "server.log"), os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0777)
	if err != nil {
		panic(err)
	}
	logger = log.New(file, "", 11)
	go beforeStart()
	go signalHandler()
}

func main() {
	var err error
	serverListener, err = net.Listen("tcp", ":7000")
	if err != nil {
		panic(err)
	}
	for {
		if isUpdate == true {
			continue
		}
		conn, err := serverListener.Accept()
		if err != nil {
			logger.Println("conn error")
			continue
		}
		c := conn.(*net.TCPConn)
		go connectionHandler(c)
	}
}

func connectionHandler(conn *net.TCPConn) {
	file, _ := conn.File()
	connFiles.Store(file, true)
	logger.Printf("conn fd %d\n", file.Fd())
	defer func() {
		connFiles.Delete(file)
		_ = conn.Close()
	}()
	for {
		if isUpdate == true {
			continue
		}
		err := conn.SetReadDeadline(time.Now().Add(readTimeout))
		if err != nil {
			logger.Println(err.Error())
			return
		}
		rBuf := make([]byte, 4)
		_, err = conn.Read(rBuf)
		if err != nil {
			logger.Println(err.Error())
			return
		}
		if string(rBuf) != "ping" {
			logger.Println("failed to parse the message " + string(rBuf))
			return
		}
		err = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		if err != nil {
			logger.Println(err.Error())
			return
		}
		_, err = conn.Write([]byte(`pong`))
		if err != nil {
			logger.Println(err.Error())
			return
		}
	}
}

func beforeStart() {
	connInterface, err := net.Dial("unix", filepath.Join(workSpace, "conn.sock"))
	if err != nil {
		logger.Println(err.Error())
		return
	}
	defer func() {
		_ = connInterface.Close()
	}()

	unixConn := connInterface.(*net.UnixConn)

	b := make([]byte, 1)
	oob := make([]byte, 32)
	for {
		err = unixConn.SetWriteDeadline(time.Now().Add(time.Minute * 3))
		if err != nil {
			fmt.Println(err.Error())
			return
		}
		n, oobn, _, _, err := unixConn.ReadMsgUnix(b, oob)
		if err != nil {
			logger.Println(err.Error())
			return
		}
		if n != 1 || b[0] != 0 {
			if n != 1 {
				logger.Printf("recv fd type error: %d\n", n)
			} else {
				logger.Println("init finish")
			}
			return
		}
		scms, err := unix.ParseSocketControlMessage(oob[0:oobn])
		if err != nil {
			logger.Println(err.Error())
			return
		}
		if len(scms) != 1 {
			logger.Printf("recv fd num != 1 : %d\n", len(scms))
			return
		}
		fds, err := unix.ParseUnixRights(&scms[0])
		if err != nil {
			logger.Println(err.Error())
			return
		}
		if len(fds) != 1 {
			logger.Printf("recv fd num != 1 : %d\n", len(fds))
			return
		}
		logger.Printf("recv fd %d\n", fds[0])
		file := os.NewFile(uintptr(fds[0]), "fd-from-old")
		conn, err := net.FileConn(file)
		if err != nil {
			logger.Println(err.Error())
			return
		}
		go connectionHandler(conn.(*net.TCPConn))
	}
}

func signalHandler() {
	signal.Notify(
		signalChan,
		syscall.SIGUSR2,
	)
	for {
		sc := <-signalChan
		switch sc {
		case syscall.SIGUSR2:
			gracefulExit()
		default:
			continue
		}
	}
}

func gracefulExit() {
	var connWait sync.WaitGroup
	_ = syscall.Unlink(filepath.Join(workSpace, "conn.sock"))
	listenerInterface, err := net.Listen("unix", filepath.Join(workSpace, "conn.sock"))
	if err != nil {
		logger.Println(err.Error())
		return
	}
	defer func() {
		_ = listenerInterface.Close()
	}()
	unixListener := listenerInterface.(*net.UnixListener)
	connWait.Add(1)
	go func() {
		defer connWait.Done()
		unixConn, err := unixListener.AcceptUnix()
		if err != nil {
			logger.Println(err.Error())
			return
		}
		defer func() {
			_ = unixConn.Close()
		}()
		connFiles.Range(func(key, value interface{}) bool {
			if key == nil || value == nil {
				return false
			}
			file := key.(*os.File)
			defer func() {
				_ = file.Close()
			}()
			buf := make([]byte, 1)
			buf[0] = 0
			rights := syscall.UnixRights(int(file.Fd()))
			_, _, err := unixConn.WriteMsgUnix(buf, rights, nil)
			if err != nil {
				logger.Println(err.Error())
			}
			logger.Printf("send fd %d\n", file.Fd())
			return true
		})
		finish := make([]byte, 1)
		finish[0] = 1
		_, _, err = unixConn.WriteMsgUnix(finish, nil, nil)
		if err != nil {
			logger.Println(err.Error())
		}
	}()

	isUpdate = true
	execSpec := &syscall.ProcAttr{
		Env:   os.Environ(),
		Files: append([]uintptr{os.Stdin.Fd(), os.Stdout.Fd(), os.Stderr.Fd()}),
	}

	pid, err := syscall.ForkExec(os.Args[0], os.Args, execSpec)
	if err != nil {
		logger.Println(err.Error())
		return
	}
	logger.Printf("old process %d new process %d\n", os.Getpid(), pid)
	_ = serverListener.Close()

	connWait.Wait()
	os.Exit(0)
}
```

```go
// client.go
package main

import (
	"fmt"
	"net"
	"time"
)

var (
	writeTimeout = time.Second * 5
	readTimeout  = time.Second * 5
)

func main() {
	conn, err := net.Dial("tcp", "127.0.0.1:7000")
	if err != nil {
		panic(err)
	}
	defer func() {
		conn.Close()
	}()
	for {
		time.Sleep(time.Second)
		err := conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		if err != nil {
			fmt.Println(err.Error())
			break
		}
		fmt.Println("send ping")
		_, err = conn.Write([]byte(`ping`))
		if err != nil {
			fmt.Println(err.Error())
			break
		}
		err = conn.SetReadDeadline(time.Now().Add(readTimeout))
		if err != nil {
			fmt.Println(err.Error())
			break
		}
		rBuf := make([]byte, 4)
		_, err = conn.Read(rBuf)
		if err != nil {
			fmt.Println(err.Error())
		}
		fmt.Println("recv " + string(rBuf))
	}
}
```
