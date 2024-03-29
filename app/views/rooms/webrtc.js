// copy shareable link 
document.getElementById("copy-button").addEventListener("click", function(e) {
  e.preventDefault();

  var copied;
  document.getElementById("copy-room-name").select();

  try {
    copied = document.execCommand("copy");
  } catch (e) {
    copied = false;
  }

  if (copied) {
    document.getElementById("copy-button").innerHTML = "Saved to Clipboard!"
  }
});

// support for multiple browsers
window.navigator.mediaDevices.getUserMedia = window.navigator.mediaDevices.getUserMedia ||
window.navigator.webkitGetUserMedia ||
window.navigator.mozGetUserMedia;

// Broadcast Types
const JOIN_ROOM = "JOIN_ROOM";
const EXCHANGE = "EXCHANGE";
const REMOVE_USER = "REMOVE_USER";

// DOM Elements
const currentUser = document.getElementById("currentUser").dataset.email;
const selfView = document.getElementById("selfView");
const remoteViewContainer = document.getElementById("remoteViewContainer");
const joinBtnContainer = document.getElementById("join-btn-container");
const leaveBtnContainer = document.getElementById("leave-btn-container");

// Configuration
let roomName = document.getElementById("room-name").dataset.room;
let constraints = { audio: true, video: true, videofec: false };

// Global Objects
let pcPeers = {};
let localStream;

window.onload = () => {
  initialize();
};

// Ice Credentials for Stun and turn server
const ice =  { 
  'iceServers': [
    {'urls': 'stun:stun.1.google.com:19302'},
    {"urls":"turn:numb.viagenie.ca", "username":"webrtc@live.com", "credential":"muazkh"}]
  } ;

// for echo cancellation
document.getElementById('selfView').volume = 0

// stream local video
const initialize = async () => {
  
  window.navigator.mediaDevices
    .getUserMedia(constraints)
    .then(stream => {
      //display your local video in #selfView element
      localStream = stream;
      selfView.srcObject = stream;
      selfView.muted = false;
    })
    .catch(logError);
};

// when user joins this function streams through session channel
const handleJoinSession = async () => {
  App.session = await App.cable.subscriptions.create(
    { channel: "SessionChannel", id: roomName },
    {
      connected: () => connectUser(currentUser),
      received: data => {

        console.log("received", data);
        if (data.from === currentUser) return;
        switch (data.type) {
          case JOIN_ROOM:
            return joinRoom(data);
          case EXCHANGE:
            if (data.to !== currentUser) return;
            return exchange(data);
          case REMOVE_USER:
            return removeUser(data);
          default:
            return;
        }
      }
    }
  );

  joinBtnContainer.style.display = "none";
};

// when user ends the call
const handleLeaveSession = () => {
  localStream.getTracks().forEach(track => track.stop())

  for (user in pcPeers) {
    pcPeers[user].close();
  }
  pcPeers = {};

  remoteViewContainer.innerHTML = "";

  broadcastData({
    type: REMOVE_USER,
    from: currentUser,
    roomName
  });

  joinBtnContainer.style.display = "block";
  leaveBtnContainer.style.display = "none";
  setTimeout(function(){ 

    $(document).find($("#localViewContainer"))[0].style.display = "none" 
  }, 1000); 
};

// mute or unmute audio
const toggleAudio = () => {
  localStream.getAudioTracks()[0].enabled = !(localStream.getAudioTracks()[0].enabled);

  //change icon after toggle 
  if(localStream.getAudioTracks()[0].enabled == false) {
    $(document).find($(".fa")).removeClass('fa-microphone').addClass('fa-microphone-slash');
  }
  else {
    $(document).find($(".fa")).removeClass('fa-microphone-slash').addClass('fa-microphone');
  }
}

// display or hide video 
const toggleVideo = () => {
  localStream.getVideoTracks()[0].enabled = !(localStream.getVideoTracks()[0].enabled);

  //change icon after toggle 
  if(localStream.getVideoTracks()[0].enabled == false) {
    $(document).find($(".fas")).removeClass('fa-video-camera').addClass('fa-video-slash');
  }
  else {
    $(document).find($(".fas")).removeClass('fa-video-slash').addClass('fa-video-camera');
  }
}

// broadcast the room after connection of user
const connectUser = userId => {
  broadcastData({
    type: JOIN_ROOM,
    from: currentUser,
    roomName
  });
};

const joinRoom = data => {
  createPC(data.from, true);
};

// after end call is fired, the remote remote video is removed 
const removeUser = data => {
  console.log("removing user", data.from);
  let video = document.getElementById(`remoteView+${data.from}`);
  video && video.remove();
  delete pcPeers[data.from];
};

// broadcast through STUN and TURN server 
const createPC = (userId, isOffer) => {
  let pc = new RTCPeerConnection(ice);
  pcPeers[userId] = pc;
  pc.addStream(localStream);

  isOffer &&
    pc
      .createOffer()
      .then(offer => {
        pc.setLocalDescription(offer);
        broadcastData({
          type: EXCHANGE,
          from: currentUser,
          to: userId,
          sdp: JSON.stringify(pc.localDescription),
          roomName
        });
      })
      .catch(logError);

  pc.onicecandidate = event => {
    event.candidate &&
      broadcastData({
        type: EXCHANGE,
        from: currentUser,
        to: userId,
        candidate: JSON.stringify(event.candidate),
        roomName
      });
  };

  // display the video 
  pc.onaddstream = event => {
    const element = document.createElement("video");
    element.id = `remoteView+${userId}`;
    element.autoplay = "autoplay";
    element.srcObject = event.stream;
    remoteViewContainer.appendChild(element);
  };

  // when user is disconnected
  pc.oniceconnectionstatechange = event => {
    if (pc.iceConnectionState == "disconnected") {
      console.log("Disconnected:", userId);
      broadcastData({
        type: REMOVE_USER,
        from: userId,
        roomName
      });
    }
  };

  return pc;
};

// when remote user joins, candidate is added 
const exchange = data => {
  let pc;

  if (!pcPeers[data.from]) {
    pc = createPC(data.from, false);
  } else {
    pc = pcPeers[data.from];
  }

  if (data.candidate) {
    pc
      .addIceCandidate(new RTCIceCandidate(JSON.parse(data.candidate)))

      .then(() => console.log("Ice candidate added"))
      .catch(logError);
  }

  if (data.sdp) {
    sdp = JSON.parse(data.sdp);
    pc
      .setRemoteDescription(new RTCSessionDescription(sdp))
      .then(() => {
        if (sdp.type === "offer") {
          pc.createAnswer().then(answer => {
            pc.setLocalDescription(answer);
            broadcastData({
              type: EXCHANGE,
              from: currentUser,
              to: data.from,
              sdp: JSON.stringify(pc.localDescription),
              roomName
            });
          });
        }
      })
      .catch(logError);
  }
};

// actioncable server broadcast
const broadcastData = data => {

  $.ajax({
    url: "/sessions",
    type: "post",
    data
  });
};

const logError = error => console.warn("Error:", error);
