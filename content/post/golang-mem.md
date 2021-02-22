---
title: "Golang内存管理"
date: 2021-01-26T16:54:57+08:00
draft: true
---

# 代码梳理

[调度初始化](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/runtime/proc.go#L563)时调用[mallocinit](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/runtime/malloc.go#L417)初始化堆内存。

下面来看一下[mallocinit](https://github.com/golang/go/blob/9b955d2d3fcff6a5bc8bce7bafdc4c634a28e95b/src/runtime/malloc.go#L417)主要做的事情：


