package main

import (
	"encoding/xml"
	"fmt"
	"io/ioutil"
	"os"
	"strconv"
	"strings"

	"github.com/samber/lo"
)

type BililiveRecorderElement struct {
	XMLName xml.Name `xml:"BililiveRecorder"`
	Version string   `xml:"version,attr"`
}
type BililiveRecorderRecordInfoElement struct {
	XMLName        xml.Name `xml:"BililiveRecorderRecordInfo"`
	Name           string   `xml:"name,attr"`
	Title          string   `xml:"title,attr"`
	Areanameparent string   `xml:"areanameparent,attr"`
	Areanamechild  string   `xml:"areanamechild,attr"`
	Start_time     string   `xml:"start_time,attr"`
	Roomid         int      `xml:"roomid,attr"`
	Shortid        int      `xml:"shortid,attr"`
}
type DamakuElement struct {
	XMLName xml.Name `xml:"d"`
	Attr    string   `xml:"p,attr"`
	User    string   `xml:"user,attr"`
	Message string   `xml:",chardata"`
}
type GiftElement struct {
	XMLName   xml.Name `xml:"gift"`
	Timestamp string   `xml:"ts,attr"`
	User      string   `xml:"user,attr"`
	Uid       int      `xml:"uid,attr"`
	Giftname  string   `xml:"giftname,attr"`
	GiftCount int      `xml:"giftcount,attr"`
}
type GuardElement struct {
	XMLName   xml.Name `xml:"guard"`
	Timestamp string   `xml:"ts,attr"`
	User      string   `xml:"user,attr"`
	Uid       int      `xml:"uid,attr"`
	Giftname  int      `xml:"level,attr"`
	GiftCount int      `xml:"count,attr"`
}

type SuperChatElement struct {
	XMLName   xml.Name `xml:"sc"`
	Timestamp string   `xml:"ts,attr"`
	User      string   `xml:"user,attr"`
	Uid       int      `xml:"uid,attr"`
	Price     int      `xml:"price,attr"`
	Time      int      `xml:"time,attr"`
	Value     string   `xml:",chardata"`
}
type BililiveRecorderXmlStyleElement struct {
	XMLName xml.Name `xml:"BililiveRecorderXmlStyle"`
	Style   string   `xml:",innerxml"`
}
type RootElement struct {
	XMLName                    xml.Name                          `xml:"i"`
	Chatserver                 string                            `xml:"chatserver"`
	Chatid                     string                            `xml:"chatid"`
	Mission                    string                            `xml:"mission"`
	Maxlimit                   string                            `xml:"maxlimit"`
	State                      string                            `xml:"state"`
	Real_name                  string                            `xml:"real_name"`
	Source                     string                            `xml:"source"`
	BililiveRecorder           BililiveRecorderElement           `xml:"BililiveRecorder"`
	BililiveRecorderRecordInfo BililiveRecorderRecordInfoElement `xml:"BililiveRecorderRecordInfo"`
	BililiveRecorderXmlStyle   BililiveRecorderXmlStyleElement   `xml:"BililiveRecorderXmlStyle"`
	Damakus                    []DamakuElement                   `xml:"d"`
	Gifts                      []GiftElement                     `xml:"gift"`
	Guards                     []GuardElement                    `xml:"guard"`
	SuperChats                 []SuperChatElement                `xml:"sc"`
}

func main() {
	// FileName StartTime Duration
	ArgCount := len(os.Args)
	fileCount := (len(os.Args) - 1) / 3
	if fileCount < 2 {
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "[DanmakuConcat]需要拼接%d个弹幕文件\n", fileCount)
	fmt.Fprintf(os.Stderr, "[DanmakuConcat]正在读取第1个弹幕文件\n")
	file, _ := os.Open(os.Args[1])
	defer file.Close()
	data, _ := ioutil.ReadAll(file)
	root := RootElement{}
	xml.Unmarshal(data, &root)
	tmpOut, _ := strconv.ParseFloat(os.Args[3], 64)
	fmt.Fprintf(os.Stderr, "[DanmakuConcat]解析第1个弹幕文件出点:%.3f\n", tmpOut)
	fmt.Fprintf(os.Stderr, "[DanmakuConcat]正在剪切第%d个弹幕文件\n", 1)
	root.Damakus = lo.Filter(root.Damakus, func(Danmaku DamakuElement, index int) bool {
		Attributes := strings.Split(Danmaku.Attr, ",")
		tTimeStamp, _ := strconv.ParseFloat(Attributes[0], 64)
		return tTimeStamp < tmpOut
	})
	root.Gifts = lo.Filter(root.Gifts, func(Gift GiftElement, index int) bool {
		tTimeStamp, _ := strconv.ParseFloat(Gift.Timestamp, 64)
		return tTimeStamp < tmpOut
	})
	root.Guards = lo.Filter(root.Guards, func(Guard GuardElement, index int) bool {
		tTimeStamp, _ := strconv.ParseFloat(Guard.Timestamp, 64)
		return tTimeStamp < tmpOut
	})
	root.SuperChats = lo.Filter(root.SuperChats, func(SuperChat SuperChatElement, index int) bool {
		tTimeStamp, _ := strconv.ParseFloat(SuperChat.Timestamp, 64)
		return tTimeStamp < tmpOut
	})
	for i := 4; i < ArgCount; i += 3 {
		fmt.Fprintf(os.Stderr, "[DanmakuConcat]正在读取第%d个弹幕文件\n", (i-1)/3+1)
		tmpFile, _ := os.Open(os.Args[i])
		defer tmpFile.Close()
		tmpData, _ := ioutil.ReadAll(tmpFile)
		tmpRoot := RootElement{}
		xml.Unmarshal(tmpData, &tmpRoot)
		tStartTimeStamp, _ := strconv.ParseFloat(os.Args[i+1], 64)
		fmt.Fprintf(os.Stderr, "[DanmakuConcat]解析第%d个弹幕文件基准时钟:%.3f\n", (i-1)/3+1, tStartTimeStamp)
		tOut, _ := strconv.ParseFloat(os.Args[i+2], 64)
		fmt.Fprintf(os.Stderr, "[DanmakuConcat]解析第%d个弹幕文件基准出点:%.3f\n", (i-1)/3+1, tOut)
		fmt.Fprintln(os.Stderr, "[DanmakuConcat]正在转换弹幕时间戳")
		for _, Danmaku := range tmpRoot.Damakus {
			Attributes := strings.Split(Danmaku.Attr, ",")
			tTimeStamp, _ := strconv.ParseFloat(Attributes[0], 64)
			if tTimeStamp > tOut {
				continue
			}
			nTimeStamp := tTimeStamp + tStartTimeStamp
			sTimeStamp := fmt.Sprintf("%.3f", nTimeStamp)
			Attributes[0] = sTimeStamp
			Danmaku.Attr = strings.Join(Attributes, ",")
			root.Damakus = append(root.Damakus, Danmaku)
		}
		fmt.Fprintln(os.Stderr, "[DanmakuConcat]正在转换礼物时间戳")
		for _, Gift := range tmpRoot.Gifts {
			tTimeStamp, _ := strconv.ParseFloat(Gift.Timestamp, 64)
			if tTimeStamp > tOut {
				continue
			}
			nTimeStamp := tTimeStamp + tStartTimeStamp
			sTimeStamp := fmt.Sprintf("%.3f", nTimeStamp)
			Gift.Timestamp = sTimeStamp
			root.Gifts = append(root.Gifts, Gift)
		}
		fmt.Fprintln(os.Stderr, "[DanmakuConcat]正在转换舰长时间戳")
		for _, Guard := range tmpRoot.Guards {
			tTimeStamp, _ := strconv.ParseFloat(Guard.Timestamp, 64)
			if tTimeStamp > tOut {
				continue
			}
			nTimeStamp := tTimeStamp + tStartTimeStamp
			sTimeStamp := fmt.Sprintf("%.3f", nTimeStamp)
			Guard.Timestamp = sTimeStamp
			root.Guards = append(root.Guards, Guard)
		}
		fmt.Fprintln(os.Stderr, "[DanmakuConcat]正在转换SuperChat时间戳")
		for _, SuperChat := range tmpRoot.SuperChats {
			tTimeStamp, _ := strconv.ParseFloat(SuperChat.Timestamp, 64)
			if tTimeStamp > tOut {
				continue
			}
			nTimeStamp := tTimeStamp + tStartTimeStamp
			sTimeStamp := fmt.Sprintf("%.3f", nTimeStamp)
			SuperChat.Timestamp = sTimeStamp
			root.SuperChats = append(root.SuperChats, SuperChat)
		}
	}
	output, _ := xml.MarshalIndent(&root, "", "  ")
	os.Stdout.Write([]byte(xml.Header))
	os.Stdout.Write([]byte(`<?xml-stylesheet type="text/xsl" href="#s"?>` + "\n"))
	os.Stdout.Write(output)
}
