---
title: "如何使用vim作为golang和cxx开发IDE"
date: 2020-11-19T23:58:31+08:00
tags:
- Vim
- Golang
- Cxx
---


> 作为一个初学者，很多同学的路子都是这样的：费劲心思装好windows和Linux双系统，看着Linux界面难看，开始找美化软件的工具；美化好了，安装好了g++，因为gedit不好用，sublimetext、atom好用但是不太方便编译，然后陷入vim还是emacs的抉择；最终决定用vim，打印了一张vim键盘图开始学习，略为抱怨门槛高；入门之后发现写代码确实快了很多，为了更快，更美观，开始折腾vim的插件，学习怎么打tag等等等等…感觉万事具备，只欠好好学c++了，发现需要学习g++的编译连接，库文件，多个源文件，大工程，然后开始学习makefile的写法…从此越跑越偏，后来突然发现python看起来简单，要不学python吧。后来又觉得python似乎找工作不占很大优势，转而学java。后来又觉得javascript更简单，所以搞前端吧。然后发现还需要学html、css、数据库、日新月异的新框架…一本书，《c++从入门到放弃》。

# 1. 最终成品
先给大家看看成品的样子
![vim_0.jpg](/images/vim_0.jpeg)

# 2. 所见即所得
折腾vim大概有四五年的时间了，下面总结了想要将vim作为主开发工具需要的条件。

|类别|功能|备注|
|---|---|---|
|开发|代码跳转|✔|
| |查看引用|✔|
| |代码补全|✔|
| |查找替换|✔|
| |变量、函数更名|✔|
|辅助|文件目录|✔|
| |函数目录|✔|
| |注释|✔|
| |全局搜索文件|✔|
| |全局搜索关键词|✔|
| |补全括号|✔|
|美化|主题|✔|
| |状态栏|✔|
| |Git信息|✔|
| |启动页美化|✔|

## 2.1 准备
很多插件在neo-vim下支持更好，但是寡人是个念旧的人，所以一直用【*VIM - Vi IMproved 8.2*】
所以在开始配置之前，需要准备vim 8.0以上版本并且支持python3
```bash
git clone https://github.com/vim/vim.git
cd vim
./configure --with-features=huge \
	--enable-multibyte \
	--enable-python3interp=yes \
	--with-python3-config-dir=[你机器上python3的路径] \
	--enable-gui=gtk2 \
	--enable-cscope \
	--prefix=/usr/local/vim
make
sudo make install
```
如果不知道python3的路径，可以用whereis python3找一下。
最终下面的效果就可以了。
```bash
➜  ~ vim --version
VIM - Vi IMproved 8.2 (2019 Dec 12, compiled May 26 2020 06:16:44)
macOS version
...
+comments          +linebreak         +python3           +visualextra
...
```

## 2.2 插件管理
现在最通用的插件管理插件就是[vim-plug](https://github.com/junegunn/vim-plug)了，支持异步安装更新。
- 安装
```bash
curl -fLo ~/.vim/autoload/plug.vim --create-dirs \
    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
```

- 使用
想安装某个插件只需要在.vimrc里配置
```vim
call plug#begin('~/.vim/plugged')
    Plug 'scrooloose/nerdtree'                          " 目录树
    Plug 'scrooloose/nerdcommenter'                     " 注释
    Plug 'vim-airline/vim-airline'                      " Vim状态栏插件，包括显示行号，列号，文件类型，文件名，以及Git状态
    Plug 'tpope/vim-fugitive'                           " 显示git分支
    Plug 'Yggdroot/LeaderF', { 'tag': 'v1.22', 'do': './install.sh' }   " 全局搜索
    Plug 'fatih/vim-go', { 'do': ':GoUpdateBinaries' }  " vim-go
    Plug 'yianwillis/vimcdoc'                           " 中文文档
    Plug 'neoclide/coc.nvim', {'branch': 'release'}     " 补全
    Plug 'octol/vim-cpp-enhanced-highlight'             " C++高亮
    Plug 'mhinz/vim-startify'                           " 启动界面
call plug#end()
```
然后在vim的NORMAL状态(按ESC)下执行```:PlugInstall```即可完成插件的安装。
![vim_1](/images/vim_1.jpeg)

插件更新的命令为```:PlugUpdate```
vim-plug更新的命令为```:PlugUpgrade```

## 2.3 开发

### 2.3.1 插件安装
vim代码跳转、查看引用、代码补全、变量更名功能现在流行的解决方案都是基于微软提出的[LSP协议](https://microsoft.github.io/language-server-protocol/)进行开发，我使用的插件是[coc-nvim](https://github.com/neoclide/coc.nvim)是目前比较好的LSP客户端插件。

coc-nvim基于nodejs开发，所以首先安装nodejs
```bash
curl -sL install-node.now.sh/lts | bash
```

使用vim-plug安装coc-nvim
```vim
call plug#begin('~/.vim/plugged')
    Plug 'fatih/vim-go', { 'do': ':GoUpdateBinaries' }  " vim-go
    Plug 'neoclide/coc.nvim', {'branch': 'release'}     " 补全
call plug#end()
```
因为[vim-go](https://github.com/fatih/vim-go)针对go开发定制了特别多功能，所以通常会连着vim-go一起安装。

- vim-go
安装完之后需要到vim里执行```:GoInstallBinaries```安装vim-go需要的一些go工具(gopls，goimports等，可能需要科学上网)

- coc-nvim
安装完需要到vim里用coc-nvim配置golang和cxx环境，```:CocInstall coc-go``` ```:CocInstall coc-clangd```
![vim_3](/images/vim_3.jpeg)

### 2.3.2 插件配置

安装完需要配置一下，下面是vim-go的配置，coc-nvim配置太长了，附录里有完整配置可以参考。

```vim
" vim-go {

let g:go_fmt_command="goimports" " 格式化将默认的 gofmt 替换
let g:go_info_mode='gopls'
let g:go_def_mode='gopls'
let g:go_rename_command='gopls'  " 重命名变量
let g:go_referrers_mode='gopls'

" 美化类
let g:go_autodetect_gopath=1
let g:go_list_type="quickfix"
let g:go_version_warning=1
let g:go_highlight_types=1
let g:go_highlight_fields=1
let g:go_highlight_functions=1
let g:go_highlight_function_calls=1
let g:go_highlight_operators=1
let g:go_highlight_extra_types=1
let g:go_highlight_methods=1
let g:go_highlight_generate_tags=1
let g:go_highlight_function_parameters = 1
let g:go_highlight_build_constraints = 1

let g:godef_split=2

" push quickfix window always to the bottom
autocmd FileType qf wincmd J

" }
```

### 2.3.3 LSP安装
coc-nvim是基于[LSP协议](https://microsoft.github.io/language-server-protocol/)开发的，所以要安装go和cxx的LSP服务器
- go
golang 有官方出的gopls，上面步骤里面vim-go已经给安装好了，只需要配置下环境变量即可
```
export PATH=$PATH:$GOPATH/bin:$HOME/.cargo/bin
```
在终端直接输入gopls有反应即可

- clangd
cpp和c的补全跳转等功能向来没有完美解决方案，小编用的是[clangd](https://clangd.llvm.org/) + [bear](https://github.com/rizsotto/Bear)
clangd最为cxx的LSP，bear用于生成编译数据库compile_commands.json
注意: mac用户使用bear需要关闭SIP
```bash
安装bear(centos下没装成功过)

ubuntu:
sudo apt-install bear

mac:
brew install bear
```
clangd安装
```bash
mkdir -p ~/.vim/LSP/bin
cd ~/.vim/LSP
wget https://github.com/clangd/clangd/releases/download/11.0.0/clangd-linux-11.0.0.zip # ubuntu
wget https://github.com/clangd/clangd/releases/download/11.0.0/clangd-mac-11.0.0.zip   # mac os

解压完，将bin目录下的clangd放到~/.vim/LSP/bin下
设置环境变量
export PATH=$PATH:$GOPATH/bin:$HOME/.vim/LSP/bin
```
在终端输入clangd有反应即可
下面就可以愉快的开发golang和cxx了

### 2.3.4 快捷键

|功能|快捷键|
|---|---|
|查看引用|leader键+gr或者:GoReferrers|
|跳转|gd|
|变量重命名|leader键+rn或者:GoRename|
|查找替换|%s/要查找的/要替换的/g|
|代码补全|自动的|
|查看channel读写情况|:GoChannelPeers|

### 2.3.5 效果
![vim_5](/images/vim_5.jpeg)

## 2.4 辅助
### 2.4.1 目录树和注释
目录插件: [nerdtree](https://github.com/preservim/nerdtree)
注释插件: [nerdcommenter](https://github.com/scrooloose/nerdcommenter)
- 安装
```vim
call plug#begin('~/.vim/plugged')
    Plug 'scrooloose/nerdtree'                          " 目录树
    Plug 'scrooloose/nerdcommenter'                     " 注释
call plug#end()
```
- 配置
```vim
" NERDTree {

nmap <leader>n :NERDTreeToggle<CR>
" map <F4> :NERDTreeToggle<CR>

"设置NERDTree的宽度
let NERDTreeWinSize=30
let g:NERDTreeWinPos='left'

let g:NERDTreeShowIgnoredStatus=1

let g:NERDTreeDirArrowExpandable = '+'
let g:NERDTreeDirArrowCollapsible = '-'

" }

" nerdcommenter {

let g:NERDSpaceDelims=1 " 注释后加空格

" }

```

- 快捷键

|功能|快捷键|
|---|---|
|打开关闭目录|leader键+n|
|注释|leader键+c|

### 2.4.2 补全括号
在vim执行```:CocInstall coc-pairs```

### 2.4.3 全局搜索
插件: [LeaderF](https://github.com/Yggdroot/LeaderF)

- 安装
```vim
call plug#begin('~/.vim/plugged')
    Plug 'Yggdroot/LeaderF', { 'tag': 'v1.22', 'do': './install.sh' }   " 全局搜索
call plug#end()
```
- 配置
```vim
" LeaderF {

let g:Lf_ShortcutF='<C-P>'
" let g:Lf_ShowDevIcons=0

" }
```

- 快捷键

|功能|快捷键|
|---|---|
|文件搜索|leader键+p或者:LeaderfFile|
|函数目录|:LeaderfFunction|
|已打开文件跳转|:LeaderfBuffer|
|变量搜索|::LeaderfRgInteractive|

- 成品图
![vim_2](/images/vim_2.jpeg)

## 2.5 美化
### 2.5.1 主题
[onedark](https://github.com/joshdick/onedark.vim)
- 安装
```vim
call plug#begin('~/.vim/plugged')
    Plug 'joshdick/onedark.vim'
call plug#end()
```
- 配置
```vim
" Colorscheme {

" 语法高亮
syntax  on

" 文件类型带上颜色
syntax  enable

" 文件类型探测 使用缩进文件
filetype plugin indent on

set background=light

" 设置主题
colorscheme onedark

" Set the vertical split character to  a space (there is a single space after '\ ')
set fillchars+=vert:\ 
highlight VertSplit ctermbg=236 ctermfg=236

" }
```

### 2.5.2 状态栏
[vim-airline](https://github.com/vim-airline/vim-airline)

- 安装
```vim
call plug#begin('~/.vim/plugged')
    Plug 'vim-airline/vim-airline'
call plug#end()
```

- 配置
```vim
" vim-airline {

if !exists('g:airline_symbols')
    let g:airline_symbols={}
endif

let airline#extensions#tabline#ignore_bufadd_pat =
            \ '\c\vgundo|undotree|vimfiler|tagbar|nerd_tree'
let g:airline#extensions#tabline#keymap_ignored_filetypes =
            \ ['vimfiler', 'nerdtree']

let g:airline#extensions#tabline#left_sep = ''
let g:airline#extensions#tabline#left_alt_sep = ''
let g:airline#extensions#tabline#right_sep = ''
let g:airline#extensions#tabline#right_alt_sep = ''


let g:airline_left_sep = ''
let g:airline_left_alt_sep = ''
let g:airline_right_sep = ''
let g:airline_right_alt_sep = ''
let g:airline_symbols.branch = ''
let g:airline_symbols.readonly = ''
let g:airline_symbols.linenr = '☰'
let g:airline_symbols.maxlinenr = ''
let g:airline_symbols.dirty='⚡'

" let g:airline_theme='jellybeans'
let g:airline#extensions#tabline#formatter = 'unique_tail'
" }
```

### 2.5.3 GIT信息和启动页
[vim-fugitive](https://github.com/tpope/vim-fugitive)
[vim-startify](https://github.com/mhinz/vim-startify)
- 安装
```vim
call plug#begin('~/.vim/plugged')
    Plug 'tpope/vim-fugitive'                           " 显示git分支
    Plug 'mhinz/vim-startify'                           " 启动界面
call plug#end()
```

- 效果
![vim_4](/images/vim_4.jpeg)

# 附录
## 完整配置
```vim
" Common config {

" 设置行号
set number

" 不生成备份文件
set nobackup 

" 不创建临时交换文件
set noswapfile     

" 右下角显示光标位置
set ruler

" 查找不区分大小写
set ignorecase

" 查找高亮
set hlsearch

" 启用256色
" set t_Co=16

" 不兼容VI
set nocompatible

" 设置保存历史(命令, 查找模式的历史
set history=1024

" 右下角显示未完成的命令 
set showcmd

" 再输入部分查找模式时显示相应的匹配点 
set incsearch

" 使用UTF-8编码
set encoding=utf-8

" 所在行高亮
" set cursorcolumn
set cursorline

" 相对行号
" set relativenumber

" 使用鼠标
" set mouse=a

" 显示TAB键
" set list

" 自动保存
" set autowrite

" 设置n个字自动换行
" set textwidth=n

set foldmethod=syntax

set nofoldenable

" 设置leader键
let mapleader="\<space>"

" 恢复光标位置
if has("autocmd")
    au BufReadPost * if line("'\"") > 1 && line("'\"") <= line("$") | exe "normal! g'\"" | endif
endif

" 右侧打开内置terminal
nmap <leader>t :rightbelow vert term<CR>

" }

" Plugin Management {

filetype off
call plug#begin('~/.vim/plugged')
    Plug 'scrooloose/nerdtree'                          " 目录树
    Plug 'scrooloose/nerdcommenter'                     " 注释
    Plug 'vim-airline/vim-airline'                      " Vim状态栏插件，包括显示行号，列号，文件类型，文件名，以及Git状态
    Plug 'tpope/vim-fugitive'                           " 显示git分支
    Plug 'Yggdroot/LeaderF', { 'tag': 'v1.22', 'do': './install.sh' }   " 全局搜索
    Plug 'fatih/vim-go', { 'do': ':GoUpdateBinaries' }  " vim-go
    Plug 'yianwillis/vimcdoc'                           " 中文文档
    Plug 'neoclide/coc.nvim', {'branch': 'release'}     " 补全
    Plug 'octol/vim-cpp-enhanced-highlight'             " C++高亮
    Plug 'mhinz/vim-startify'                           " 启动界面
call plug#end()

" coc-nvim {

" TextEdit might fail if hidden is not set.
set hidden

" Some servers have issues with backup files, see #649.
set nobackup
set nowritebackup

" Give more space for displaying messages.
set cmdheight=1

" Having longer updatetime (default is 4000 ms = 4 s) leads to noticeable
" delays and poor user experience.
set updatetime=300

" Don't pass messages to |ins-completion-menu|.
set shortmess+=c

" Always show the signcolumn, otherwise it would shift the text each time
" diagnostics appear/become resolved.
if has("patch-8.1.1564")
  " Recently vim can merge signcolumn and number column into one
  set signcolumn=number
else
  set signcolumn=yes
endif

" Use tab for trigger completion with characters ahead and navigate.
" NOTE: Use command ':verbose imap <tab>' to make sure tab is not mapped by
" other plugin before putting this into your config.
inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()
inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

" Use <c-space> to trigger completion.
if has('nvim')
  inoremap <silent><expr> <c-space> coc#refresh()
else
  inoremap <silent><expr> <c-@> coc#refresh()
endif

" Use <cr> to confirm completion, `<C-g>u` means break undo chain at current
" position. Coc only does snippet and additional edit on confirm.
" <cr> could be remapped by other vim plugin, try `:verbose imap <CR>`.
if exists('*complete_info')
  inoremap <expr> <cr> complete_info()["selected"] != "-1" ? "\<C-y>" : "\<C-g>u\<CR>"
else
  inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
endif

" Use `[g` and `]g` to navigate diagnostics
" Use `:CocDiagnostics` to get all diagnostics of current buffer in location list.
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

" GoTo code navigation.
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)

" Use K to show documentation in preview window.
nnoremap <silent> K :call <SID>show_documentation()<CR>

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocActionAsync('doHover')
  endif
endfunction

" Highlight the symbol and its references when holding the cursor.
autocmd CursorHold * silent call CocActionAsync('highlight')

" Symbol renaming.
nmap <leader>rn <Plug>(coc-rename)

" Formatting selected code.
xmap <leader>f  <Plug>(coc-format-selected)
nmap <leader>f  <Plug>(coc-format-selected)

augroup mygroup
  autocmd!
  " Setup formatexpr specified filetype(s).
  autocmd FileType typescript,json setl formatexpr=CocAction('formatSelected')
  " Update signature help on jump placeholder.
  autocmd User CocJumpPlaceholder call CocActionAsync('showSignatureHelp')
augroup end

" Applying codeAction to the selected region.
" Example: `<leader>aap` for current paragraph
xmap <leader>a  <Plug>(coc-codeaction-selected)
nmap <leader>a  <Plug>(coc-codeaction-selected)

" Remap keys for applying codeAction to the current buffer.
nmap <leader>ac  <Plug>(coc-codeaction)
" Apply AutoFix to problem on the current line.
nmap <leader>qf  <Plug>(coc-fix-current)

" Map function and class text objects
" NOTE: Requires 'textDocument.documentSymbol' support from the language server.
xmap if <Plug>(coc-funcobj-i)
omap if <Plug>(coc-funcobj-i)
xmap af <Plug>(coc-funcobj-a)
omap af <Plug>(coc-funcobj-a)
xmap ic <Plug>(coc-classobj-i)
omap ic <Plug>(coc-classobj-i)
xmap ac <Plug>(coc-classobj-a)
omap ac <Plug>(coc-classobj-a)

" Use CTRL-S for selections ranges.
" Requires 'textDocument/selectionRange' support of language server.
nmap <silent> <C-s> <Plug>(coc-range-select)
xmap <silent> <C-s> <Plug>(coc-range-select)

" Add `:Format` command to format current buffer.
command! -nargs=0 Format :call CocAction('format')

" Add `:Fold` command to fold current buffer.
command! -nargs=? Fold :call     CocAction('fold', <f-args>)

" Add `:OR` command for organize imports of the current buffer.
command! -nargs=0 OR   :call     CocAction('runCommand', 'editor.action.organizeImport')

" Add (Neo)Vim's native statusline support.
" NOTE: Please see `:h coc-status` for integrations with external plugins that
" provide custom statusline: lightline.vim, vim-airline.
" set statusline^=%{coc#status()}%{get(b:,'coc_current_function','')}

" Mappings for CoCList
" Show all diagnostics.
nnoremap <silent><nowait> <space>a  :<C-u>CocList diagnostics<cr>
" Manage extensions.
nnoremap <silent><nowait> <space>e  :<C-u>CocList extensions<cr>
" Show commands.
nnoremap <silent><nowait> <space>c  :<C-u>CocList commands<cr>
" Find symbol of current document.
nnoremap <silent><nowait> <space>o  :<C-u>CocList outline<cr>
" Search workspace symbols.
nnoremap <silent><nowait> <space>s  :<C-u>CocList -I symbols<cr>
" Do default action for next item.
nnoremap <silent><nowait> <space>j  :<C-u>CocNext<CR>
" Do default action for previous item.
nnoremap <silent><nowait> <space>k  :<C-u>CocPrev<CR>
" Resume latest coc list.
nnoremap <silent><nowait> <space>p  :<C-u>CocListResume<CR>

" }

" Colorscheme {

" 语法高亮
syntax  on

" 文件类型带上颜色
syntax  enable

" 文件类型探测 使用缩进文件
filetype plugin indent on

set background=light

" 设置主题
colorscheme onedark

" Set the vertical split character to  a space (there is a single space after '\ ')
set fillchars+=vert:\ 
highlight VertSplit ctermbg=236 ctermfg=236

" }

" vim-go {

let g:go_fmt_command="goimports" " 格式化将默认的 gofmt 替换
let g:go_info_mode='gopls'
let g:go_def_mode='gopls'
let g:go_rename_command='gopls'  " 重命名变量
let g:go_referrers_mode='gopls'

let g:go_autodetect_gopath=1
let g:go_list_type="quickfix"
let g:go_version_warning=1
let g:go_highlight_types=1
let g:go_highlight_fields=1
let g:go_highlight_functions=1
let g:go_highlight_function_calls=1
let g:go_highlight_operators=1
let g:go_highlight_extra_types=1
let g:go_highlight_methods=1
let g:go_highlight_generate_tags=1
let g:go_highlight_function_parameters = 1
let g:go_highlight_build_constraints = 1

let g:godef_split=2

" push quickfix window always to the bottom
autocmd FileType qf wincmd J

" }

" LeaderF {

let g:Lf_ShortcutF='<C-P>'
" let g:Lf_ShowDevIcons=0

" }

" NERDTree {

nmap <leader>n :NERDTreeToggle<CR>
" map <F4> :NERDTreeToggle<CR>

"设置NERDTree的宽度
let NERDTreeWinSize=30
let g:NERDTreeWinPos='left'

let g:NERDTreeShowIgnoredStatus=1

let g:NERDTreeDirArrowExpandable = '+'
let g:NERDTreeDirArrowCollapsible = '-'
"  *        

" }

" vim-airline {

if !exists('g:airline_symbols')
    let g:airline_symbols={}
endif

let airline#extensions#tabline#ignore_bufadd_pat =
            \ '\c\vgundo|undotree|vimfiler|tagbar|nerd_tree'
let g:airline#extensions#tabline#keymap_ignored_filetypes =
            \ ['vimfiler', 'nerdtree']

let g:airline#extensions#tabline#left_sep = ''
let g:airline#extensions#tabline#left_alt_sep = ''
let g:airline#extensions#tabline#right_sep = ''
let g:airline#extensions#tabline#right_alt_sep = ''


let g:airline_left_sep = ''
let g:airline_left_alt_sep = ''
let g:airline_right_sep = ''
let g:airline_right_alt_sep = ''
let g:airline_symbols.branch = ''
let g:airline_symbols.readonly = ''
let g:airline_symbols.linenr = '☰'
let g:airline_symbols.maxlinenr = ''
let g:airline_symbols.dirty='⚡'

" let g:airline_theme='jellybeans'
let g:airline#extensions#tabline#formatter = 'unique_tail'
" }

" nerdcommenter {

let g:NERDSpaceDelims=1 " 注释后加空格

" }

" Compile {

command! -nargs=0 CodeForces :call RunCXXCodeForces()
command! -nargs=0 CxxRun :call RunCPP()
command! -nargs=0 ShellRun :call RunSH()

" shell
func! RunSH()
    exec "w"
    exec "!sh ./%"
endfunc

" CXX
func! RunCPP()
    exec "w"
    exec "!g++ % -std=c++17 -o %<"
    exec "! ./%<"
endfunc

" codeforces
func! RunCXXCodeForces()
    exec "w"
    exec "!g++ % -std=c++17 -o %<"
    exec "! ./%< < in"
endfunc
" }

" Code Style {

autocmd FileType cpp,c,yaml exec ":call SetCppFileConfig()" 
autocmd FileType go,bash,python,java,html,javascipt,vim,sh,dot exec ":call SetCommonFileConfig()"

func SetCppFileConfig()
    " 设置tab为2个空格
    set tabstop=2

    " 设置缩进为2个空格
    set shiftwidth=2

    " 用space替代tab的输入
    set expandtab  
endfunc

func SetCommonFileConfig()
    " 设置tab为4个空格
    set tabstop=4

    " 设置缩进为4个空格
    set shiftwidth=4

    " 用space替代tab的输入
    set expandtab  

endfunc

" }


nmap <F8> :!dot % -T png -Gsize=4,6\! -Gdpi=50 -o %<.png && open %<.png <CR>
```
