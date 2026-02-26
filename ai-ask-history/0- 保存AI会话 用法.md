
# tmux 保存终端AI会话

tmux attach -t claude || tmux new -s claude

或者 按日期分类存
claude | tee -a claude-$(date +%F).log
claude | tee -a ~/Downloads/claude-$(date +%F).log


