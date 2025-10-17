#!/usr/bin/expect -f

# SFTP upload script for OAuth callback
set timeout 30

# SFTP connection details
set host "fs-bonde.easywp.com"
set user "comoon-106697f"
set password "QC069VJNgS1TCfglTb8a"
set port "22"
set local_file "oauth-callback.php"
set remote_path "public_html/oauth/"

# Connect to SFTP
spawn sftp -P $port $user@$host

# Handle password prompt
expect {
    "password:" {
        send "$password\r"
        exp_continue
    }
    "Password:" {
        send "$password\r"
        exp_continue
    }
    "sftp>" {
        # Connected successfully
    }
    timeout {
        puts "Connection timeout"
        exit 1
    }
    eof {
        puts "Connection failed"
        exit 1
    }
}

# Create oauth directory if it doesn't exist
send "mkdir -p $remote_path\r"
expect "sftp>"

# Upload the file
send "put $local_file $remote_path/index.php\r"
expect {
    "sftp>" {
        puts "File uploaded successfully!"
    }
    timeout {
        puts "Upload timeout"
        exit 1
    }
}

# List files to verify
send "ls -la $remote_path\r"
expect "sftp>"

# Exit
send "quit\r"
expect eof

puts "Upload completed!"






